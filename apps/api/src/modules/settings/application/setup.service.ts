import {
  type completeSetupRequestSchema,
  DESCRIPTOR_NAMESPACE_KEYS,
  DESCRIPTOR_NAMESPACES,
  type Institution,
  type SetupStatusResponse,
} from '@emis/contracts';
import { branches, departments, descriptors, institution } from '@emis/db';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { z } from 'zod';

import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService } from '../../audit/index.js';
import { settingsErrors } from '../domain/errors.js';
import { findPreset, PRESETS } from '../domain/presets.js';
import { InstitutionService, toInstitution } from './institution.service.js';

type SetupInput = z.output<typeof completeSetupRequestSchema>;

/** First-run wizard: fills in the institution, creates branches and departments, seeds lists. */
@Injectable()
export class SetupService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly institution: InstitutionService,
    private readonly audit: AuditService,
  ) {}

  async status(): Promise<SetupStatusResponse> {
    const row = await this.institution.row();
    return { completed: row.setupCompletedAt !== null, presets: [...PRESETS] };
  }

  /**
   * One transaction, run once. Branches, departments and list values that already exist (an admin
   * may have added some from Settings first) are kept as they are.
   */
  @Transactional()
  async complete(input: SetupInput, actor: Actor): Promise<Institution> {
    const current = await this.institution.row({ forUpdate: true });
    if (current.setupCompletedAt) throw settingsErrors.setupCompleted();

    const presetDepartments = input.presets.flatMap((key) => {
      const preset = findPreset(key);
      if (!preset) throw settingsErrors.unknownPreset(key);
      return preset.departments.map((d, i) => ({ ...d, sortOrder: i }));
    });
    // Custom departments win over a preset one with the same code.
    const departmentsByCode = new Map(
      [...presetDepartments, ...input.departments].map((d, i) => [
        d.code,
        { ...d, sortOrder: d.sortOrder || (i + 1) * 10 },
      ]),
    );
    const audit = { createdBy: actor.userId, updatedBy: actor.userId };

    const createdBranches = await this.txHost.tx
      .insert(branches)
      .values(input.branches.map((b) => ({ ...b, ...audit })))
      .onConflictDoNothing()
      .returning({ id: branches.id });
    const createdDepartments =
      departmentsByCode.size === 0
        ? []
        : await this.txHost.tx
            .insert(departments)
            .values([...departmentsByCode.values()].map((d) => ({ ...d, ...audit })))
            .onConflictDoNothing()
            .returning({ id: departments.id });
    const listValues = input.seedDefaultLists
      ? DESCRIPTOR_NAMESPACE_KEYS.flatMap((namespace) =>
          DESCRIPTOR_NAMESPACES[namespace].defaults.map(([code, label], i) => ({
            namespace,
            code,
            label,
            sortOrder: (i + 1) * 10,
            ...audit,
          })),
        )
      : [];
    const createdValues =
      listValues.length === 0
        ? []
        : await this.txHost.tx
            .insert(descriptors)
            .values(listValues)
            .onConflictDoNothing()
            .returning({ id: descriptors.id });

    const [row] = await this.txHost.tx
      .update(institution)
      .set({
        ...input.institution,
        setupCompletedAt: new Date(),
        updatedBy: actor.userId,
        version: sql`${institution.version} + 1`,
      })
      .where(eq(institution.id, current.id))
      .returning();
    if (!row) throw settingsErrors.setupCompleted();

    await this.audit.record({
      action: 'setup.completed',
      entityType: 'institution',
      entityId: row.id,
      changes: {
        name: row.name,
        presets: input.presets,
        branchesCreated: createdBranches.length,
        departmentsCreated: createdDepartments.length,
        listValuesCreated: createdValues.length,
      },
    });
    return toInstitution(row);
  }
}
