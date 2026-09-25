import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { courses } from './catalog.js';
import { cohorts, enrollments } from './cohorts.js';
import { baseColumns, idColumn } from './columns.js';
import { userAccounts } from './identity.js';
import { branches } from './settings.js';
import { students } from './students.js';

const tstz = (name: string) => timestamp(name, { withTimezone: true });
/** Money: whole minor units (santim). `mode: 'number'` is exact up to 2^53, far above any invoice. */
const money = (name: string) => bigint(name, { mode: 'number' });

export interface FeeComponentValue {
  name: string;
  amount: number;
}
export interface PlanInstallmentValue {
  shareBp: number;
  dueOffsetDays: number;
}

/** The price of a course, from a date on. To change prices, add one with a later date. */
export const feeStructures = pgTable(
  'fee_structures',
  {
    ...baseColumns(),
    name: text('name').notNull(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'restrict' }),
    categoryCode: text('category_code'),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    currency: text('currency').notNull(),
    components: jsonb('components').$type<FeeComponentValue[]>().notNull(),
    total: money('total').notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    unique('fee_structures_course_category_from_key')
      .on(t.courseId, t.categoryCode, t.effectiveFrom)
      .nullsNotDistinct(),
    index('fee_structures_course_id_idx').on(t.courseId),
    check('fee_structures_total_check', sql`${t.total} > 0`),
  ],
);

/** How an invoice is split into instalments: shares in basis points and due-date offsets. */
export const paymentPlans = pgTable(
  'payment_plans',
  {
    ...baseColumns(),
    name: text('name').notNull(),
    installments: jsonb('installments').$type<PlanInstallmentValue[]>().notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('payment_plans_name_key').on(t.name),
    // At most one default plan.
    uniqueIndex('payment_plans_one_default_key')
      .on(t.isDefault)
      .where(sql`${t.isDefault}`),
  ],
);

export const INVOICE_STATUS_VALUES = ['issued', 'partially_paid', 'paid', 'void'] as const;

/**
 * What a student owes for one enrollment. The number, lines and subtotal are fixed once issued
 * (a trigger enforces it); only the discount, paid total and status move, always together with
 * the instalments, inside one transaction holding this row's lock.
 */
export const invoices = pgTable(
  'invoices',
  {
    ...baseColumns(),
    number: text('number').notNull(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    enrollmentId: uuid('enrollment_id').references(() => enrollments.id, { onDelete: 'restrict' }),
    cohortId: uuid('cohort_id').references(() => cohorts.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    currency: text('currency').notNull(),
    status: text('status')
      .$type<(typeof INVOICE_STATUS_VALUES)[number]>()
      .notNull()
      .default('issued'),
    lines: jsonb('lines').$type<{ description: string; amount: number }[]>().notNull(),
    subtotal: money('subtotal').notNull(),
    discountTotal: money('discount_total').notNull().default(0),
    total: money('total').notNull(),
    paidTotal: money('paid_total').notNull().default(0),
  },
  (t) => [
    uniqueIndex('invoices_number_key').on(t.number),
    // One invoice per enrollment: creating it twice is impossible, not just unlikely.
    uniqueIndex('invoices_enrollment_id_key')
      .on(t.enrollmentId)
      .where(sql`${t.enrollmentId} is not null`),
    index('invoices_student_id_idx').on(t.studentId),
    index('invoices_status_idx').on(t.status),
    index('invoices_created_at_idx').on(t.createdAt.desc(), t.id.desc()),
    check(
      'invoices_status_check',
      sql`${t.status} in ('issued', 'partially_paid', 'paid', 'void')`,
    ),
    check(
      'invoices_amounts_check',
      sql`${t.subtotal} > 0 and ${t.discountTotal} >= 0 and ${t.discountTotal} <= ${t.subtotal}`,
    ),
    check('invoices_total_check', sql`${t.total} = ${t.subtotal} - ${t.discountTotal}`),
    check('invoices_paid_check', sql`${t.paidTotal} >= 0 and ${t.paidTotal} <= ${t.total}`),
  ],
);

export const installments = pgTable(
  'installments',
  {
    id: idColumn(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    sequence: integer('sequence').notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    amount: money('amount').notNull(),
    paidAmount: money('paid_amount').notNull().default(0),
  },
  (t) => [
    unique('installments_invoice_sequence_key').on(t.invoiceId, t.sequence),
    index('installments_due_date_idx').on(t.dueDate),
    check('installments_amount_check', sql`${t.amount} >= 0`),
    check('installments_paid_check', sql`${t.paidAmount} >= 0 and ${t.paidAmount} <= ${t.amount}`),
  ],
);

export const PAYMENT_STATUS_VALUES = ['posted', 'void'] as const;

/** Money received. Never deleted; a mistake is voided (with a second person's approval), not erased. */
export const payments = pgTable(
  'payments',
  {
    ...baseColumns(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    providerKey: text('provider_key').notNull(),
    method: text('method').notNull(),
    reference: text('reference'),
    amount: money('amount').notNull(),
    currency: text('currency').notNull(),
    status: text('status')
      .$type<(typeof PAYMENT_STATUS_VALUES)[number]>()
      .notNull()
      .default('posted'),
    receivedBy: uuid('received_by').references(() => userAccounts.id, { onDelete: 'restrict' }),
    receivedAt: tstz('received_at').notNull().defaultNow(),
    voidedAt: tstz('voided_at'),
  },
  (t) => [
    index('payments_invoice_id_idx').on(t.invoiceId),
    index('payments_student_id_idx').on(t.studentId),
    index('payments_created_at_idx').on(t.createdAt.desc(), t.id.desc()),
    check('payments_amount_check', sql`${t.amount} > 0`),
    check('payments_status_check', sql`${t.status} in ('posted', 'void')`),
    check('payments_method_check', sql`${t.method} in ('cash', 'bank_transfer', 'cheque')`),
  ],
);

/** Which instalments a payment paid down, oldest due first. */
export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    installmentId: uuid('installment_id')
      .notNull()
      .references(() => installments.id, { onDelete: 'restrict' }),
    amount: money('amount').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.paymentId, t.installmentId] }),
    check('payment_allocations_amount_check', sql`${t.amount} > 0`),
  ],
);

/**
 * The receipt for a payment. Numbers come from a gapless counter inside the same transaction as
 * the payment, so they run 1, 2, 3… with no holes; a voided receipt keeps its number.
 */
export const receipts = pgTable(
  'receipts',
  {
    id: idColumn(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    number: text('number').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('issued'),
    issuedAt: tstz('issued_at').notNull().defaultNow(),
    voidedAt: tstz('voided_at'),
  },
  (t) => [
    uniqueIndex('receipts_payment_id_key').on(t.paymentId),
    uniqueIndex('receipts_number_key').on(t.number),
    check('receipts_status_check', sql`${t.status} in ('issued', 'void')`),
  ],
);

/** An approved reduction of an invoice. */
export const discounts = pgTable(
  'discounts',
  {
    id: idColumn(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    value: money('value').notNull(),
    amount: money('amount').notNull(),
    reasonCode: text('reason_code').notNull(),
    approvalId: uuid('approval_id').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('discounts_invoice_id_idx').on(t.invoiceId),
    check('discounts_kind_check', sql`${t.kind} in ('percent', 'fixed')`),
    check('discounts_amount_check', sql`${t.amount} > 0`),
  ],
);

/**
 * Maker-checker: one person asks, a different person decides. The database refuses a decider who
 * is the requester, so separation of duties doesn't depend on the API being right.
 */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    ...baseColumns(),
    type: text('type').notNull(),
    status: text('status').notNull().default('pending'),
    subjectId: uuid('subject_id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    summary: text('summary').notNull(),
    reason: text('reason').notNull(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => userAccounts.id, { onDelete: 'restrict' }),
    decidedBy: uuid('decided_by').references(() => userAccounts.id, { onDelete: 'restrict' }),
    decisionNote: text('decision_note'),
    decidedAt: tstz('decided_at'),
  },
  (t) => [
    index('approval_requests_status_idx').on(t.status, t.createdAt.desc()),
    index('approval_requests_subject_idx').on(t.subjectId),
    // One open request per thing: no piling up duplicate void requests.
    uniqueIndex('approval_requests_one_pending_key')
      .on(t.type, t.subjectId)
      .where(sql`${t.status} = 'pending'`),
    check('approval_requests_type_check', sql`${t.type} in ('discount', 'payment_void')`),
    check(
      'approval_requests_status_check',
      sql`${t.status} in ('pending', 'approved', 'rejected')`,
    ),
    check(
      'approval_requests_separation_check',
      sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.requestedBy}`,
    ),
    check(
      'approval_requests_decided_check',
      sql`(${t.status} = 'pending') = (${t.decidedBy} is null)`,
    ),
  ],
);
