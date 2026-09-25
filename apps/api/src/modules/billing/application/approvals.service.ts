import {
  type Approval,
  type ApprovalListQuery,
  type ApprovalListResponse,
  type DecideApprovalValues,
  formatMoney,
  type RequestDiscountValues,
  type RequestVoid,
} from '@emis/contracts';
import {
  afterCursor,
  approvalRequests,
  decodeCursor,
  toPage,
  updateWithVersion,
  userAccounts,
} from '@emis/db';
import { type Grant, hasPermission } from '@emis/permissions';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { assertScope } from '../../../common/authz/scope.js';
import { isUniqueViolation } from '../../../common/db/errors.js';
import { versionedRow } from '../../../common/http/versioning.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService } from '../../audit/index.js';
import { DescriptorsService } from '../../settings/index.js';
import { billingErrors } from '../domain/errors.js';
import { discountAmount } from '../domain/money-flow.js';
import { InvoicesService } from './invoices.service.js';
import { PaymentsService } from './payments.service.js';

type ApprovalRow = typeof approvalRequests.$inferSelect;

const requesters = alias(userAccounts, 'requesters');
const deciders = alias(userAccounts, 'deciders');

/**
 * Maker-checker. Sensitive money changes (a discount, voiding a payment) are requested by one
 * person and only happen when a different person approves. The rule is enforced three ways: the
 * service refuses, and the database refuses a decider equal to the requester and a change to a
 * decided request. Approving runs the change in the same transaction as the decision.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly descriptors: DescriptorsService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  // --- reading -------------------------------------------------------------------------------

  private async present(ids: string[]): Promise<Approval[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({
        approval: approvalRequests,
        requesterName: requesters.displayName,
        deciderName: deciders.displayName,
      })
      .from(approvalRequests)
      .innerJoin(requesters, eq(requesters.id, approvalRequests.requestedBy))
      .leftJoin(deciders, eq(deciders.id, approvalRequests.decidedBy))
      .where(inArray(approvalRequests.id, ids));
    const byId = new Map(
      rows.map((r): [string, Approval] => [
        r.approval.id,
        {
          id: r.approval.id,
          type: r.approval.type as Approval['type'],
          status: r.approval.status as Approval['status'],
          subjectId: r.approval.subjectId,
          summary: r.approval.summary,
          reason: r.approval.reason,
          requestedBy: { id: r.approval.requestedBy, name: r.requesterName },
          decidedBy: r.approval.decidedBy
            ? { id: r.approval.decidedBy, name: r.deciderName ?? '' }
            : null,
          decisionNote: r.approval.decisionNote,
          createdAt: r.approval.createdAt.toISOString(),
          decidedAt: r.approval.decidedAt?.toISOString() ?? null,
          version: r.approval.version,
        },
      ]),
    );
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  /** Everything for people who can decide; only their own requests for everyone else. */
  async list(
    query: ApprovalListQuery,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<ApprovalListResponse> {
    const conditions: (SQL | undefined)[] = [
      query.status ? eq(approvalRequests.status, query.status) : undefined,
      query.type ? eq(approvalRequests.type, query.type) : undefined,
      hasPermission(grants, 'approvals.decide')
        ? undefined
        : eq(approvalRequests.requestedBy, actor.userId),
    ];
    if (query.cursor) {
      const [createdAt, id] = decodeCursor(query.cursor, 2);
      conditions.push(
        afterCursor(
          [approvalRequests.createdAt, approvalRequests.id],
          [String(createdAt), String(id)],
          'desc',
        ),
      );
    }
    const rows = await this.db
      .select({ id: approvalRequests.id, createdAt: approvalRequests.createdAt })
      .from(approvalRequests)
      .where(and(...conditions))
      .orderBy(desc(approvalRequests.createdAt), desc(approvalRequests.id))
      .limit(query.limit + 1);
    const page = toPage(rows, query.limit, (r) => [r.createdAt.toISOString(), r.id]);
    return { items: await this.present(page.items.map((r) => r.id)), nextCursor: page.nextCursor };
  }

  // --- requesting ----------------------------------------------------------------------------

  private async create(
    input: {
      type: 'discount' | 'payment_void';
      subjectId: string;
      payload: Record<string, unknown>;
      summary: string;
      reason: string;
    },
    actor: Actor,
  ): Promise<Approval> {
    let row: ApprovalRow | undefined;
    try {
      [row] = await this.db
        .insert(approvalRequests)
        .values({
          ...input,
          requestedBy: actor.userId,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw billingErrors.requestPending();
      throw error;
    }
    if (!row) throw billingErrors.approvalNotFound();
    await this.audit.record({
      action: 'approval.requested',
      entityType: 'approval',
      entityId: row.id,
      changes: { type: row.type, subjectId: row.subjectId, summary: row.summary },
    });
    const [approval] = await this.present([row.id]);
    if (!approval) throw billingErrors.approvalNotFound();
    return approval;
  }

  @Transactional()
  async requestDiscount(
    invoiceId: string,
    input: RequestDiscountValues,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Approval> {
    const invoice = await this.invoices.row(invoiceId);
    assertScope(grants, 'billing.request', { branchId: invoice.branchId });
    if (invoice.status === 'void' || invoice.status === 'paid') throw billingErrors.invoiceClosed();
    await this.descriptors.assertActiveCode('discount_reason', input.reasonCode);

    const amount = discountAmount(input.kind, input.value, invoice.total);
    if (amount < 1) throw billingErrors.discountTooSmall();
    if (amount > invoice.total - invoice.paidTotal) throw billingErrors.discountTooLarge();

    const what =
      input.kind === 'percent'
        ? `${input.value / 100}% off`
        : `${formatMoney(input.value, invoice.currency)} off`;
    return this.create(
      {
        type: 'discount',
        subjectId: invoiceId,
        payload: {
          kind: input.kind,
          value: input.value,
          reasonCode: input.reasonCode,
          note: input.note,
        },
        summary: `${what} invoice ${invoice.number} (${formatMoney(amount, invoice.currency)})`,
        reason: input.note || input.reasonCode,
      },
      actor,
    );
  }

  @Transactional()
  async requestVoid(
    paymentId: string,
    input: RequestVoid,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Approval> {
    const payment = await this.payments.row(paymentId);
    assertScope(grants, 'billing.request', { branchId: payment.branchId });
    if (payment.status !== 'posted') throw billingErrors.paymentNotPosted();
    const view = await this.payments.view(paymentId);
    return this.create(
      {
        type: 'payment_void',
        subjectId: paymentId,
        payload: { receiptNumber: view.receiptNumber, amount: payment.amount },
        summary: `Void receipt ${view.receiptNumber} (${formatMoney(payment.amount, payment.currency)}) on invoice ${view.invoiceNumber}`,
        reason: input.reason,
      },
      actor,
    );
  }

  // --- deciding ------------------------------------------------------------------------------

  /**
   * Approve (which makes the change, in this transaction) or reject. The request row is locked
   * so two people can't decide it at once; the requester can never decide their own.
   */
  @Transactional()
  async decide(id: string, input: DecideApprovalValues, actor: Actor): Promise<Approval> {
    const [request] = await this.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, id))
      .for('update');
    if (!request) throw billingErrors.approvalNotFound();
    if (request.status !== 'pending') throw billingErrors.approvalDecided();
    if (request.requestedBy === actor.userId) throw billingErrors.selfApproval();

    if (input.decision === 'approve') {
      const payload = request.payload;
      if (request.type === 'discount') {
        await this.invoices.applyDiscount(
          request.subjectId,
          {
            kind: payload.kind as 'percent' | 'fixed',
            value: Number(payload.value),
            reasonCode: String(payload.reasonCode),
            approvalId: request.id,
          },
          actor,
        );
      } else {
        await this.payments.voidPayment(request.subjectId, request.id, actor);
      }
    }

    versionedRow(
      await updateWithVersion(this.db, approvalRequests, id, request.version, {
        status: input.decision === 'approve' ? 'approved' : 'rejected',
        decidedBy: actor.userId,
        decisionNote: input.note || null,
        decidedAt: new Date(),
        updatedBy: actor.userId,
      }),
      billingErrors.approvalNotFound,
    );
    await this.audit.record({
      action: input.decision === 'approve' ? 'approval.approved' : 'approval.rejected',
      entityType: 'approval',
      entityId: id,
      changes: { type: request.type, subjectId: request.subjectId },
    });
    const [approval] = await this.present([id]);
    if (!approval) throw billingErrors.approvalNotFound();
    return approval;
  }
}
