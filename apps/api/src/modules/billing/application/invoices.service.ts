import type {
  CreateInvoiceValues,
  Invoice,
  InvoiceListQuery,
  InvoiceListResponse,
} from '@emis/contracts';
import {
  afterCursor,
  decodeCursor,
  discounts,
  installments,
  invoices,
  students,
  toPage,
} from '@emis/db';
import type { Grant } from '@emis/permissions';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';

import { assertBranchAccess, assertScope, branchReach } from '../../../common/authz/scope.js';
import { isUniqueViolation } from '../../../common/db/errors.js';
import { escapeLike, searchTokens } from '../../../common/db/like.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService } from '../../audit/index.js';
import { EnrollmentsService } from '../../cohorts/index.js';
import { InstitutionService, NumberingService } from '../../settings/index.js';
import { StudentsService } from '../../students/index.js';
import { billingErrors } from '../domain/errors.js';
import {
  applyDiscount,
  buildInstallments,
  discountAmount,
  installmentStatusFor,
  invoiceStatusFor,
} from '../domain/money-flow.js';
import { FeesService } from './fees.service.js';

export type InvoiceRow = typeof invoices.$inferSelect;
export type InstallmentRow = typeof installments.$inferSelect;

/** A UUID nobody has: a caller with no branch access matches no rows. */
const NO_BRANCH = '00000000-0000-0000-0000-000000000000';

/**
 * Invoices and their instalments. Whenever money moves, the caller first takes this invoice's row
 * lock (`lock`), changes the instalments, and calls `settle`, which recomputes the invoice's paid
 * total, total and status from the instalments, so the two can never disagree.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly fees: FeesService,
    private readonly enrollments: EnrollmentsService,
    private readonly students: StudentsService,
    private readonly numbering: NumberingService,
    private readonly institution: InstitutionService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  // --- reading -------------------------------------------------------------------------------

  private async present(rows: InvoiceRow[]): Promise<Invoice[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const owners = await this.db
      .select({
        id: students.id,
        number: students.studentNumber,
        givenName: students.givenName,
        fatherName: students.fatherName,
      })
      .from(students)
      .where(
        inArray(
          students.id,
          rows.map((r) => r.studentId),
        ),
      );
    const parts = await this.db
      .select()
      .from(installments)
      .where(inArray(installments.invoiceId, ids))
      .orderBy(asc(installments.sequence));
    const today = await this.institution.today();

    return rows.map((row) => {
      const owner = owners.find((o) => o.id === row.studentId);
      return {
        id: row.id,
        number: row.number,
        studentId: row.studentId,
        studentName: owner ? `${owner.givenName} ${owner.fatherName}` : '',
        studentNumber: owner?.number ?? '',
        enrollmentId: row.enrollmentId,
        branchId: row.branchId,
        currency: row.currency,
        status: row.status,
        lines: row.lines,
        subtotal: row.subtotal,
        discountTotal: row.discountTotal,
        total: row.total,
        paidTotal: row.paidTotal,
        balance: row.status === 'void' ? 0 : row.total - row.paidTotal,
        installments: parts
          .filter((p) => p.invoiceId === row.id)
          .map((p) => ({
            id: p.id,
            sequence: p.sequence,
            dueDate: p.dueDate,
            amount: p.amount,
            paidAmount: p.paidAmount,
            status: installmentStatusFor(p, today),
          })),
        createdAt: row.createdAt.toISOString(),
        version: row.version,
      };
    });
  }

  async list(query: InvoiceListQuery, grants: readonly Grant[]): Promise<InvoiceListResponse> {
    const reach = branchReach(grants, 'billing.read');
    const conditions: (SQL | undefined)[] = [
      query.studentId ? eq(invoices.studentId, query.studentId) : undefined,
      query.status ? eq(invoices.status, query.status) : undefined,
      reach === 'all'
        ? undefined
        : inArray(invoices.branchId, reach.length > 0 ? reach : [NO_BRANCH]),
    ];
    if (query.stage) {
      conditions.push(
        query.stage === 'unpaid'
          ? inArray(invoices.status, ['issued', 'partially_paid'])
          : inArray(invoices.status, ['paid', 'void']),
      );
    }
    for (const token of searchTokens(query.q ?? '')) {
      const pattern = `%${escapeLike(token)}%`;
      conditions.push(
        or(
          ilike(invoices.number, pattern),
          sql`${invoices.studentId} in (select id from students where search_name ilike ${pattern} or student_number ilike ${pattern})`,
        ),
      );
    }
    if (query.cursor) {
      const [createdAt, id] = decodeCursor(query.cursor, 2);
      conditions.push(
        afterCursor([invoices.createdAt, invoices.id], [String(createdAt), String(id)], 'desc'),
      );
    }
    const rows = await this.db
      .select()
      .from(invoices)
      .where(and(...conditions))
      .orderBy(desc(invoices.createdAt), desc(invoices.id))
      .limit(query.limit + 1);
    const page = toPage(rows, query.limit, (r) => [r.createdAt.toISOString(), r.id]);
    return { items: await this.present(page.items), nextCursor: page.nextCursor };
  }

  async row(id: string): Promise<InvoiceRow> {
    const [row] = await this.db.select().from(invoices).where(eq(invoices.id, id));
    if (!row) throw billingErrors.invoiceNotFound();
    return row;
  }

  async get(id: string, grants: readonly Grant[]): Promise<Invoice> {
    const row = await this.row(id);
    assertBranchAccess(grants, 'billing.read', row.branchId);
    const [invoice] = await this.present([row]);
    if (!invoice) throw billingErrors.invoiceNotFound();
    return invoice;
  }

  /** What is still owed on an enrollment's invoice, or null if it has none. Void invoices owe nothing. */
  async balanceForEnrollment(enrollmentId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ status: invoices.status, total: invoices.total, paidTotal: invoices.paidTotal })
      .from(invoices)
      .where(eq(invoices.enrollmentId, enrollmentId));
    if (!row) return null;
    return row.status === 'void' ? 0 : row.total - row.paidTotal;
  }

  /** The same view for other services in this module, after they've done their own checks. */
  async view(id: string): Promise<Invoice> {
    const [invoice] = await this.present([await this.row(id)]);
    if (!invoice) throw billingErrors.invoiceNotFound();
    return invoice;
  }

  // --- creating ------------------------------------------------------------------------------

  /**
   * Bill an enrollment: price the course for this student, split it by the payment plan, and issue
   * the invoice with its instalments. One invoice per enrollment, guaranteed by a unique index.
   */
  @Transactional()
  async create(
    input: CreateInvoiceValues,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Invoice> {
    const ctx = await this.enrollments.billingContext(input.enrollmentId);
    if (!ctx) throw billingErrors.enrollmentNotBillable();
    assertScope(grants, 'billing.invoice', { branchId: ctx.branchId });
    if (ctx.status !== 'active' && ctx.status !== 'completed')
      throw billingErrors.enrollmentNotBillable();

    const [existing] = await this.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.enrollmentId, ctx.enrollmentId));
    if (existing) throw billingErrors.alreadyInvoiced();

    const student = await this.students.requireExisting(ctx.studentId);
    const today = await this.institution.today();
    const structure =
      (await this.fees.resolve(ctx.courseId, student.categoryCode, ctx.startDate)) ??
      (await this.fees.resolve(ctx.courseId, student.categoryCode, today));
    if (!structure) throw billingErrors.noFeeStructure();

    const plan = input.planId
      ? await this.fees.findPlan(input.planId)
      : await this.fees.defaultPlan();
    if (input.planId && !plan?.isActive) throw billingErrors.paymentPlanNotFound();
    if (!plan) throw billingErrors.noPaymentPlan();

    const { number } = await this.numbering.next('invoice', { branchId: ctx.branchId });
    let invoice: InvoiceRow | undefined;
    try {
      [invoice] = await this.db
        .insert(invoices)
        .values({
          number,
          studentId: ctx.studentId,
          enrollmentId: ctx.enrollmentId,
          cohortId: ctx.cohortId,
          branchId: ctx.branchId,
          currency: structure.currency,
          lines: structure.components.map((c) => ({ description: c.name, amount: c.amount })),
          subtotal: structure.total,
          total: structure.total,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw billingErrors.alreadyInvoiced();
      throw error;
    }
    if (!invoice) throw billingErrors.invoiceNotFound();
    await this.db.insert(installments).values(
      buildInstallments(structure.total, plan.installments, today).map((part) => ({
        ...part,
        invoiceId: invoice.id,
      })),
    );

    await this.audit.record({
      action: 'invoice.created',
      entityType: 'invoice',
      entityId: invoice.id,
      changes: {
        number: invoice.number,
        studentNumber: student.studentNumber,
        total: invoice.total,
        instalments: plan.installments.length,
      },
    });
    return this.view(invoice.id);
  }

  // --- changing money (callers hold the lock) -------------------------------------------------

  /** Take the invoice's row lock. Everything that moves money on an invoice does this first. */
  async lock(id: string): Promise<InvoiceRow> {
    const [row] = await this.db.select().from(invoices).where(eq(invoices.id, id)).for('update');
    if (!row) throw billingErrors.invoiceNotFound();
    return row;
  }

  async installmentsOf(invoiceId: string): Promise<InstallmentRow[]> {
    return this.db
      .select()
      .from(installments)
      .where(eq(installments.invoiceId, invoiceId))
      .orderBy(asc(installments.sequence));
  }

  /** Recompute the invoice's totals and status from its instalments. Call after changing them. */
  async settle(invoiceId: string, actor: Actor): Promise<InvoiceRow> {
    const before = await this.row(invoiceId);
    const parts = await this.installmentsOf(invoiceId);
    const total = parts.reduce((sum, p) => sum + p.amount, 0);
    const paidTotal = parts.reduce((sum, p) => sum + p.paidAmount, 0);
    const [row] = await this.db
      .update(invoices)
      .set({
        total,
        paidTotal,
        discountTotal: before.subtotal - total,
        status: before.status === 'void' ? 'void' : invoiceStatusFor(total, paidTotal),
        updatedBy: actor.userId,
        version: before.version + 1,
      })
      .where(eq(invoices.id, invoiceId))
      .returning();
    if (!row) throw billingErrors.invoiceNotFound();
    return row;
  }

  /**
   * Apply an approved discount: cut the unpaid instalments from the latest due date backward and
   * record it. The amount is worked out now, on the invoice as it is today, and refused if it has
   * become more than what's still unpaid.
   */
  @Transactional()
  async applyDiscount(
    invoiceId: string,
    discount: { kind: 'percent' | 'fixed'; value: number; reasonCode: string; approvalId: string },
    actor: Actor,
  ): Promise<void> {
    const invoice = await this.lock(invoiceId);
    if (invoice.status === 'void' || invoice.status === 'paid') throw billingErrors.invoiceClosed();
    const parts = await this.installmentsOf(invoiceId);

    const amount = discountAmount(discount.kind, discount.value, invoice.total);
    if (amount < 1) throw billingErrors.discountTooSmall();
    if (amount > invoice.total - invoice.paidTotal) throw billingErrors.discountTooLarge();

    for (const change of applyDiscount(parts, amount)) {
      await this.db
        .update(installments)
        .set({ amount: change.newAmount })
        .where(eq(installments.id, change.installmentId));
    }
    await this.db.insert(discounts).values({ invoiceId, ...discount, amount });
    await this.settle(invoiceId, actor);
    await this.audit.record({
      action: 'invoice.discount_applied',
      entityType: 'invoice',
      entityId: invoiceId,
      changes: {
        number: invoice.number,
        kind: discount.kind,
        amount,
        approvalId: discount.approvalId,
      },
    });
  }
}
