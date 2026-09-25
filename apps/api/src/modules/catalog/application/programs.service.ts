import type {
  CreateProgramRequest,
  Program,
  ProgramListQuery,
  ProgramType,
  UpdateProgramRequest,
} from '@emis/contracts';
import { programs, updateWithVersion } from '@emis/db';
import type { Grant } from '@emis/permissions';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import { assertScope } from '../../../common/authz/scope.js';
import { isUniqueViolation } from '../../../common/db/errors.js';
import { versionedRow } from '../../../common/http/versioning.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService, diffChanges } from '../../audit/index.js';
import { OrganizationService } from '../../settings/index.js';
import { catalogErrors } from '../domain/errors.js';

type ProgramRow = typeof programs.$inferSelect;

export const toProgram = (row: ProgramRow): Program => ({
  id: row.id,
  departmentId: row.departmentId,
  code: row.code,
  name: row.name,
  type: row.type as ProgramType,
  description: row.description,
  isPublished: row.isPublished,
  sortOrder: row.sortOrder,
  version: row.version,
});

/**
 * Programs (what's taught under a department). Anyone with `catalog.read` sees them all; changing
 * one needs `catalog.manage` for the program's department, so a Coordinator only edits their own.
 */
@Injectable()
export class ProgramsService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly org: OrganizationService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  async list(query: ProgramListQuery): Promise<Program[]> {
    const rows = await this.db
      .select()
      .from(programs)
      .where(query.departmentId ? eq(programs.departmentId, query.departmentId) : undefined)
      .orderBy(asc(programs.sortOrder), asc(programs.name));
    return rows.map(toProgram);
  }

  /** The row itself, for other services that need its department (e.g. to scope-check a course). */
  async row(id: string): Promise<ProgramRow> {
    const [row] = await this.db.select().from(programs).where(eq(programs.id, id));
    if (!row) throw catalogErrors.programNotFound();
    return row;
  }

  async get(id: string): Promise<Program> {
    return toProgram(await this.row(id));
  }

  @Transactional()
  async create(
    input: Required<CreateProgramRequest>,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Program> {
    assertScope(grants, 'catalog.manage', { departmentId: input.departmentId });
    if (!(await this.org.isActiveUnit('department', input.departmentId))) {
      throw catalogErrors.departmentNotFound();
    }

    let row: ProgramRow | undefined;
    try {
      [row] = await this.db
        .insert(programs)
        .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw catalogErrors.codeTaken('program');
      throw error;
    }
    if (!row) throw catalogErrors.programNotFound();

    await this.audit.record({
      action: 'program.created',
      entityType: 'program',
      entityId: row.id,
      changes: { code: row.code, name: row.name, departmentId: row.departmentId },
    });
    return toProgram(row);
  }

  @Transactional()
  async update(
    id: string,
    input: UpdateProgramRequest,
    expectedVersion: number,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Program> {
    const before = await this.row(id);
    assertScope(grants, 'catalog.manage', { departmentId: before.departmentId });

    const row = versionedRow(
      await updateWithVersion(this.db, programs, id, expectedVersion, {
        ...input,
        updatedBy: actor.userId,
      }),
      catalogErrors.programNotFound,
    );
    await this.audit.record({
      action: 'program.updated',
      entityType: 'program',
      entityId: id,
      changes: { code: before.code, ...diffChanges(before, input) },
    });
    return toProgram(row);
  }
}
