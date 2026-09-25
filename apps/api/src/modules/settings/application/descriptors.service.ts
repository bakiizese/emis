import type {
  CreateDescriptorRequest,
  Descriptor,
  DescriptorNamespace,
  UpdateDescriptorRequest,
} from '@emis/contracts';
import { descriptors, updateWithVersion } from '@emis/db';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import { isUniqueViolation } from '../../../common/db/errors.js';
import { versionedRow } from '../../../common/http/versioning.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService, diffChanges } from '../../audit/index.js';
import { settingsErrors } from '../domain/errors.js';

type DescriptorRow = typeof descriptors.$inferSelect;

const toDescriptor = (row: DescriptorRow): Descriptor => ({
  id: row.id,
  namespace: row.namespace as DescriptorNamespace,
  code: row.code,
  label: row.label,
  sortOrder: row.sortOrder,
  isActive: row.isActive,
  version: row.version,
});

/** Institution-defined dropdown values. Codes are stable (records store them); labels can change. */
@Injectable()
export class DescriptorsService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly audit: AuditService,
  ) {}

  async list(namespace: DescriptorNamespace): Promise<Descriptor[]> {
    const rows = await this.txHost.tx
      .select()
      .from(descriptors)
      .where(eq(descriptors.namespace, namespace))
      .orderBy(asc(descriptors.sortOrder), asc(descriptors.label));
    return rows.map(toDescriptor);
  }

  @Transactional()
  async create(
    input: CreateDescriptorRequest & { code: string },
    actor: Actor,
  ): Promise<Descriptor> {
    let row: DescriptorRow | undefined;
    try {
      [row] = await this.txHost.tx
        .insert(descriptors)
        .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw settingsErrors.codeTaken('value in this list');
      throw error;
    }
    if (!row) throw settingsErrors.descriptorNotFound();
    await this.audit.record({
      action: 'descriptor.created',
      entityType: 'descriptor',
      entityId: row.id,
      changes: { namespace: row.namespace, code: row.code, label: row.label },
    });
    return toDescriptor(row);
  }

  @Transactional()
  async update(
    id: string,
    input: UpdateDescriptorRequest,
    expectedVersion: number,
    actor: Actor,
  ): Promise<Descriptor> {
    const [before] = await this.txHost.tx.select().from(descriptors).where(eq(descriptors.id, id));
    if (!before) throw settingsErrors.descriptorNotFound();
    const row = versionedRow(
      await updateWithVersion(this.txHost.tx, descriptors, id, expectedVersion, {
        ...input,
        updatedBy: actor.userId,
      }),
      settingsErrors.descriptorNotFound,
    );
    await this.audit.record({
      action: 'descriptor.updated',
      entityType: 'descriptor',
      entityId: id,
      changes: { namespace: before.namespace, code: before.code, ...diffChanges(before, input) },
    });
    return toDescriptor(row);
  }
}
