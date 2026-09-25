import type {
  CreateFeeStructureValues,
  CreatePaymentPlanValues,
  FeeStructure,
  PaymentPlan,
  UpdateFeeStructureRequest,
  UpdatePaymentPlanRequest,
} from '@emis/contracts';
import { feeStructures, paymentPlans, updateWithVersion } from '@emis/db';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, lte, or } from 'drizzle-orm';

import { isUniqueViolation } from '../../../common/db/errors.js';
import { versionedRow } from '../../../common/http/versioning.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService } from '../../audit/index.js';
import { CoursesService } from '../../catalog/index.js';
import { DescriptorsService, InstitutionService } from '../../settings/index.js';
import { billingErrors } from '../domain/errors.js';

type FeeRow = typeof feeStructures.$inferSelect;
type PlanRow = typeof paymentPlans.$inferSelect;

const toFeeStructure = (row: FeeRow): FeeStructure => ({
  id: row.id,
  name: row.name,
  courseId: row.courseId,
  categoryCode: row.categoryCode,
  effectiveFrom: row.effectiveFrom,
  currency: row.currency,
  components: row.components,
  total: row.total,
  isActive: row.isActive,
  version: row.version,
});

const toPlan = (row: PlanRow): PaymentPlan => ({
  id: row.id,
  name: row.name,
  installments: row.installments,
  isDefault: row.isDefault,
  isActive: row.isActive,
  version: row.version,
});

/** What courses cost, and how an invoice is split into instalments. */
@Injectable()
export class FeesService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly courses: CoursesService,
    private readonly descriptors: DescriptorsService,
    private readonly institution: InstitutionService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  // --- fee structures ------------------------------------------------------------------------

  async listStructures(courseId?: string): Promise<FeeStructure[]> {
    const rows = await this.db
      .select()
      .from(feeStructures)
      .where(courseId ? eq(feeStructures.courseId, courseId) : undefined)
      .orderBy(asc(feeStructures.courseId), desc(feeStructures.effectiveFrom));
    return rows.map(toFeeStructure);
  }

  @Transactional()
  async createStructure(input: CreateFeeStructureValues, actor: Actor): Promise<FeeStructure> {
    const course = await this.courses.findWithDepartment(input.courseId);
    if (!course) throw billingErrors.feeStructureNotFound();
    await this.descriptors.assertActiveCode('student_category', input.categoryCode);
    const { currency } = await this.institution.row();
    const total = input.components.reduce((sum, c) => sum + c.amount, 0);

    let row: FeeRow | undefined;
    try {
      [row] = await this.db
        .insert(feeStructures)
        .values({ ...input, currency, total, createdBy: actor.userId, updatedBy: actor.userId })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw billingErrors.feeStructureExists();
      throw error;
    }
    if (!row) throw billingErrors.feeStructureNotFound();
    await this.audit.record({
      action: 'fee_structure.created',
      entityType: 'fee_structure',
      entityId: row.id,
      changes: {
        name: row.name,
        courseId: row.courseId,
        total: row.total,
        effectiveFrom: row.effectiveFrom,
      },
    });
    return toFeeStructure(row);
  }

  @Transactional()
  async updateStructure(
    id: string,
    input: UpdateFeeStructureRequest,
    expectedVersion: number,
    actor: Actor,
  ): Promise<FeeStructure> {
    const row = versionedRow(
      await updateWithVersion(this.db, feeStructures, id, expectedVersion, {
        ...input,
        updatedBy: actor.userId,
      }),
      billingErrors.feeStructureNotFound,
    );
    await this.audit.record({
      action: 'fee_structure.updated',
      entityType: 'fee_structure',
      entityId: id,
      changes: { fields: Object.keys(input), isActive: input.isActive },
    });
    return toFeeStructure(row);
  }

  /**
   * The price for a course on a date: a structure for the student's category beats the general
   * one, and among those the most recently effective wins. Null if nothing applies yet.
   */
  async resolve(
    courseId: string,
    categoryCode: string | null,
    asOf: string,
  ): Promise<FeeStructure | null> {
    const rows = await this.db
      .select()
      .from(feeStructures)
      .where(
        and(
          eq(feeStructures.courseId, courseId),
          eq(feeStructures.isActive, true),
          lte(feeStructures.effectiveFrom, asOf),
          categoryCode
            ? or(eq(feeStructures.categoryCode, categoryCode), isNull(feeStructures.categoryCode))
            : isNull(feeStructures.categoryCode),
        ),
      );
    const best = rows.sort(
      (a, b) =>
        Number(b.categoryCode !== null) - Number(a.categoryCode !== null) ||
        b.effectiveFrom.localeCompare(a.effectiveFrom),
    )[0];
    return best ? toFeeStructure(best) : null;
  }

  // --- payment plans -------------------------------------------------------------------------

  async listPlans(): Promise<PaymentPlan[]> {
    const rows = await this.db.select().from(paymentPlans).orderBy(asc(paymentPlans.name));
    return rows.map(toPlan);
  }

  async findPlan(id: string): Promise<PaymentPlan | null> {
    const [row] = await this.db.select().from(paymentPlans).where(eq(paymentPlans.id, id));
    return row ? toPlan(row) : null;
  }

  async defaultPlan(): Promise<PaymentPlan | null> {
    const [row] = await this.db
      .select()
      .from(paymentPlans)
      .where(and(eq(paymentPlans.isDefault, true), eq(paymentPlans.isActive, true)));
    return row ? toPlan(row) : null;
  }

  @Transactional()
  async createPlan(input: CreatePaymentPlanValues, actor: Actor): Promise<PaymentPlan> {
    if (input.isDefault) await this.clearDefault();
    let row: PlanRow | undefined;
    try {
      [row] = await this.db
        .insert(paymentPlans)
        .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw billingErrors.codeTaken('payment plan');
      throw error;
    }
    if (!row) throw billingErrors.paymentPlanNotFound();
    await this.audit.record({
      action: 'payment_plan.created',
      entityType: 'payment_plan',
      entityId: row.id,
      changes: { name: row.name, instalments: row.installments.length, isDefault: row.isDefault },
    });
    return toPlan(row);
  }

  @Transactional()
  async updatePlan(
    id: string,
    input: UpdatePaymentPlanRequest,
    expectedVersion: number,
    actor: Actor,
  ): Promise<PaymentPlan> {
    if (input.isDefault) await this.clearDefault();
    let result;
    try {
      result = await updateWithVersion(this.db, paymentPlans, id, expectedVersion, {
        ...input,
        // A retired plan can't stay the default.
        ...(input.isActive === false ? { isDefault: false } : {}),
        updatedBy: actor.userId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw billingErrors.codeTaken('payment plan');
      throw error;
    }
    const row = versionedRow(result, billingErrors.paymentPlanNotFound);
    await this.audit.record({
      action: 'payment_plan.updated',
      entityType: 'payment_plan',
      entityId: id,
      changes: { fields: Object.keys(input) },
    });
    return toPlan(row);
  }

  private async clearDefault(): Promise<void> {
    await this.db
      .update(paymentPlans)
      .set({ isDefault: false })
      .where(eq(paymentPlans.isDefault, true));
  }
}
