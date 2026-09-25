import type {
  Branch,
  CreateBranchRequest,
  CreateDepartmentRequest,
  Department,
  UpdateBranchRequest,
  UpdateDepartmentRequest,
} from '@emis/contracts';
import { branches, departments, updateWithVersion } from '@emis/db';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, ne, sql } from 'drizzle-orm';

import { isUniqueViolation } from '../../../common/db/errors.js';
import { versionedRow } from '../../../common/http/versioning.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService, diffChanges } from '../../audit/index.js';
import { settingsErrors } from '../domain/errors.js';

type BranchRow = typeof branches.$inferSelect;
type DepartmentRow = typeof departments.$inferSelect;

const toBranch = (row: BranchRow): Branch => ({
  id: row.id,
  code: row.code,
  name: row.name,
  address: row.address,
  phone: row.phone,
  isActive: row.isActive,
  version: row.version,
});

const toDepartment = (row: DepartmentRow): Department => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description,
  isActive: row.isActive,
  sortOrder: row.sortOrder,
  version: row.version,
});

/**
 * Branches (campuses) and departments (what the institution teaches). Both are small,
 * admin-maintained lists, so they're returned whole rather than paginated. Neither is ever
 * deleted: records and role scopes point at them, so they're deactivated instead.
 */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  // --- branches ------------------------------------------------------------------------------

  async listBranches(): Promise<Branch[]> {
    const rows = await this.db.select().from(branches).orderBy(asc(branches.name));
    return rows.map(toBranch);
  }

  async getBranch(id: string): Promise<Branch> {
    const [row] = await this.db.select().from(branches).where(eq(branches.id, id));
    if (!row) throw settingsErrors.branchNotFound();
    return toBranch(row);
  }

  @Transactional()
  async createBranch(input: CreateBranchRequest & { code: string }, actor: Actor): Promise<Branch> {
    let row: BranchRow | undefined;
    try {
      [row] = await this.db
        .insert(branches)
        .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw settingsErrors.codeTaken('branch');
      throw error;
    }
    if (!row) throw settingsErrors.branchNotFound();
    await this.audit.record({
      action: 'branch.created',
      entityType: 'branch',
      entityId: row.id,
      changes: { code: row.code, name: row.name },
    });
    return toBranch(row);
  }

  @Transactional()
  async updateBranch(
    id: string,
    input: UpdateBranchRequest,
    expectedVersion: number,
    actor: Actor,
  ): Promise<Branch> {
    const before = await this.getBranch(id);
    if (input.isActive === false && before.isActive) await this.assertAnotherActiveBranch(id);

    const row = versionedRow(
      await updateWithVersion(this.db, branches, id, expectedVersion, {
        ...input,
        updatedBy: actor.userId,
      }),
      settingsErrors.branchNotFound,
    );
    await this.audit.record({
      action: 'branch.updated',
      entityType: 'branch',
      entityId: id,
      changes: diffChanges(before, input),
    });
    return toBranch(row);
  }

  /** Serialized so two admins can't each deactivate one of the last two branches. */
  private async assertAnotherActiveBranch(excludingId: string): Promise<void> {
    await this.db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('emis.branches'))`);
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(branches)
      .where(and(eq(branches.isActive, true), ne(branches.id, excludingId)));
    if ((row?.count ?? 0) === 0) throw settingsErrors.lastActiveBranch();
  }

  // --- departments ---------------------------------------------------------------------------

  async listDepartments(): Promise<Department[]> {
    const rows = await this.db
      .select()
      .from(departments)
      .orderBy(asc(departments.sortOrder), asc(departments.name));
    return rows.map(toDepartment);
  }

  async getDepartment(id: string): Promise<Department> {
    const [row] = await this.db.select().from(departments).where(eq(departments.id, id));
    if (!row) throw settingsErrors.departmentNotFound();
    return toDepartment(row);
  }

  @Transactional()
  async createDepartment(
    input: CreateDepartmentRequest & { code: string },
    actor: Actor,
  ): Promise<Department> {
    let row: DepartmentRow | undefined;
    try {
      [row] = await this.db
        .insert(departments)
        .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw settingsErrors.codeTaken('department');
      throw error;
    }
    if (!row) throw settingsErrors.departmentNotFound();
    await this.audit.record({
      action: 'department.created',
      entityType: 'department',
      entityId: row.id,
      changes: { code: row.code, name: row.name },
    });
    return toDepartment(row);
  }

  @Transactional()
  async updateDepartment(
    id: string,
    input: UpdateDepartmentRequest,
    expectedVersion: number,
    actor: Actor,
  ): Promise<Department> {
    const before = await this.getDepartment(id);
    const row = versionedRow(
      await updateWithVersion(this.db, departments, id, expectedVersion, {
        ...input,
        updatedBy: actor.userId,
      }),
      settingsErrors.departmentNotFound,
    );
    await this.audit.record({
      action: 'department.updated',
      entityType: 'department',
      entityId: id,
      changes: diffChanges(before, input),
    });
    return toDepartment(row);
  }

  // --- scopes --------------------------------------------------------------------------------

  /** Whether a role can be granted at this branch or department (it exists and is active). */
  async isActiveUnit(type: 'branch' | 'department', id: string): Promise<boolean> {
    const table = type === 'branch' ? branches : departments;
    const [row] = await this.db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, id), eq(table.isActive, true)));
    return row !== undefined;
  }
}
