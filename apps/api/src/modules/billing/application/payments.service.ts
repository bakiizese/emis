import type {
  Payment,
  PaymentListQuery,
  PaymentListResponse,
  RecordPaymentValues,
} from '@emis/contracts';
import {
  afterCursor,
  decodeCursor,
  installments,
  invoices,
  paymentAllocations,
  payments,
  receipts,
  students,
  toPage,
} from '@emis/db';
import type { Grant } from '@emis/permissions';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';

import { assertBranchAccess, assertScope, branchReach } from '../../../common/authz/scope.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService } from '../../audit/index.js';
import { NumberingService } from '../../settings/index.js';
import { billingErrors } from '../domain/errors.js';
import { allocatePayment } from '../domain/money-flow.js';
import { PaymentProviders } from '../domain/providers.js';
import { InvoicesService } from './invoices.service.js';

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');

type PaymentRow = typeof payments.$inferSelect;

/** A UUID nobody has: a caller with no branch access matches no rows. */
const NO_BRANCH = '00000000-0000-0000-0000-000000000000';

/**
 * Recording and voiding payments. A payment takes the invoice's row lock, is spread over the
 * instalments oldest-due first, gets a receipt number from the gapless counter, and updates the
 * invoice, all in one transaction. Payments are never deleted: a mistake is voided, and the
 * receipt keeps its number.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly invoices: InvoicesService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProviders,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  // --- reading -------------------------------------------------------------------------------

  private async present(ids: string[]): Promise<Payment[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({
        payment: payments,
        invoiceNumber: invoices.number,
        givenName: students.givenName,
        fatherName: students.fatherName,
        receiptNumber: receipts.number,
      })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .innerJoin(students, eq(students.id, payments.studentId))
      .innerJoin(receipts, eq(receipts.paymentId, payments.id))
      .where(inArray(payments.id, ids));
    const allocations = await this.db
      .select({
        paymentId: paymentAllocations.paymentId,
        installmentId: paymentAllocations.installmentId,
        amount: paymentAllocations.amount,
        sequence: installments.sequence,
      })
      .from(paymentAllocations)
      .innerJoin(installments, eq(installments.id, paymentAllocations.installmentId))
      .where(inArray(paymentAllocations.paymentId, ids));

    const byId = new Map(
      rows.map((r): [string, Payment] => [
        r.payment.id,
        {
          id: r.payment.id,
          invoiceId: r.payment.invoiceId,
          invoiceNumber: r.invoiceNumber,
          studentId: r.payment.studentId,
          studentName: `${r.givenName} ${r.fatherName}`,
          receiptNumber: r.receiptNumber,
          branchId: r.payment.branchId,
          providerKey: r.payment.providerKey,
          method: r.payment.method as Payment['method'],
          reference: r.payment.reference,
          amount: r.payment.amount,
          currency: r.payment.currency,
          status: r.payment.status,
          receivedAt: r.payment.receivedAt.toISOString(),
          voidedAt: r.payment.voidedAt?.toISOString() ?? null,
          allocations: allocations
            .filter((a) => a.paymentId === r.payment.id)
            .sort((a, b) => a.sequence - b.sequence)
            .map(({ installmentId, sequence, amount }) => ({ installmentId, sequence, amount })),
          version: r.payment.version,
        },
      ]),
    );
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  async list(query: PaymentListQuery, grants: readonly Grant[]): Promise<PaymentListResponse> {
    const reach = branchReach(grants, 'billing.read');
    const conditions: (SQL | undefined)[] = [
      query.invoiceId ? eq(payments.invoiceId, query.invoiceId) : undefined,
      query.studentId ? eq(payments.studentId, query.studentId) : undefined,
      reach === 'all'
        ? undefined
        : inArray(payments.branchId, reach.length > 0 ? reach : [NO_BRANCH]),
    ];
    if (query.cursor) {
      const [createdAt, id] = decodeCursor(query.cursor, 2);
      conditions.push(
        afterCursor([payments.createdAt, payments.id], [String(createdAt), String(id)], 'desc'),
      );
    }
    const rows = await this.db
      .select({ id: payments.id, createdAt: payments.createdAt })
      .from(payments)
      .where(and(...conditions))
      .orderBy(desc(payments.createdAt), desc(payments.id))
      .limit(query.limit + 1);
    const page = toPage(rows, query.limit, (r) => [r.createdAt.toISOString(), r.id]);
    return { items: await this.present(page.items.map((r) => r.id)), nextCursor: page.nextCursor };
  }

  async row(id: string): Promise<PaymentRow> {
    const [row] = await this.db.select().from(payments).where(eq(payments.id, id));
    if (!row) throw billingErrors.paymentNotFound();
    return row;
  }

  async get(id: string, grants: readonly Grant[]): Promise<Payment> {
    const row = await this.row(id);
    assertBranchAccess(grants, 'billing.read', row.branchId);
    const [payment] = await this.present([id]);
    if (!payment) throw billingErrors.paymentNotFound();
    return payment;
  }

  async view(id: string): Promise<Payment> {
    const [payment] = await this.present([id]);
    if (!payment) throw billingErrors.paymentNotFound();
    return payment;
  }

  // --- recording -----------------------------------------------------------------------------

  @Transactional()
  async record(
    input: RecordPaymentValues,
    grants: readonly Grant[],
    actor: Actor,
    providerKey = 'manual',
  ): Promise<Payment> {
    const provider = this.providers.find(providerKey);
    if (!provider) throw billingErrors.unknownProvider(providerKey);
    if (!provider.methods.includes(input.method)) {
      throw billingErrors.unsupportedMethod(provider.name, input.method);
    }

    // One payment at a time per invoice, so two clerks can't both use the same last santim.
    const invoice = await this.invoices.lock(input.invoiceId);
    assertScope(grants, 'billing.receive', { branchId: invoice.branchId });
    if (invoice.status === 'void' || invoice.status === 'paid') throw billingErrors.invoiceClosed();

    const parts = await this.invoices.installmentsOf(invoice.id);
    const { allocations, remainder } = allocatePayment(parts, input.amount);
    if (remainder > 0) throw billingErrors.overpayment(invoice.total - invoice.paidTotal);

    const [payment] = await this.db
      .insert(payments)
      .values({
        invoiceId: invoice.id,
        studentId: invoice.studentId,
        branchId: invoice.branchId,
        providerKey: provider.key,
        method: input.method,
        reference: input.reference,
        amount: input.amount,
        currency: invoice.currency,
        receivedBy: actor.userId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    if (!payment) throw billingErrors.paymentNotFound();

    await this.db
      .insert(paymentAllocations)
      .values(allocations.map((a) => ({ paymentId: payment.id, ...a })));
    for (const a of allocations) {
      await this.db
        .update(installments)
        .set({ paidAmount: sql`${installments.paidAmount} + ${a.amount}` })
        .where(eq(installments.id, a.installmentId));
    }
    await this.invoices.settle(invoice.id, actor);

    // The number is taken in this transaction: if anything above fails, it's given back.
    const { number: receiptNumber } = await this.numbering.next('receipt', {
      branchId: invoice.branchId,
    });
    await this.db.insert(receipts).values({
      paymentId: payment.id,
      number: receiptNumber,
      branchId: invoice.branchId,
    });

    await this.audit.record({
      action: 'payment.recorded',
      entityType: 'payment',
      entityId: payment.id,
      changes: {
        receiptNumber,
        invoiceNumber: invoice.number,
        amount: input.amount,
        method: input.method,
        provider: provider.key,
      },
    });
    return this.view(payment.id);
  }

  // --- voiding (only ever called after an approval) ------------------------------------------

  /**
   * Reverse a payment: put its money back on the instalments, mark the payment and its receipt
   * void, and fix the invoice. Nothing is deleted, and the receipt number stays used.
   */
  @Transactional()
  async voidPayment(paymentId: string, approvalId: string, actor: Actor): Promise<void> {
    const found = await this.row(paymentId);
    const invoice = await this.invoices.lock(found.invoiceId);
    const payment = await this.row(paymentId);
    if (payment.status !== 'posted') throw billingErrors.paymentNotPosted();

    const allocations = await this.db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, paymentId));
    for (const a of allocations) {
      await this.db
        .update(installments)
        .set({ paidAmount: sql`${installments.paidAmount} - ${a.amount}` })
        .where(eq(installments.id, a.installmentId));
    }
    const now = new Date();
    await this.db
      .update(payments)
      .set({ status: 'void', voidedAt: now, updatedBy: actor.userId, version: payment.version + 1 })
      .where(eq(payments.id, paymentId));
    await this.db
      .update(receipts)
      .set({ status: 'void', voidedAt: now })
      .where(eq(receipts.paymentId, paymentId));
    await this.invoices.settle(invoice.id, actor);

    await this.audit.record({
      action: 'payment.voided',
      entityType: 'payment',
      entityId: paymentId,
      changes: { invoiceNumber: invoice.number, amount: payment.amount, approvalId },
    });
  }
}
