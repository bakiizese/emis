import { z } from 'zod';

import { positiveMinorUnitsSchema } from './money.js';

export const BILLING_ERROR_CODES = {
  feeStructureNotFound: 'FEE_STRUCTURE_NOT_FOUND',
  paymentPlanNotFound: 'PAYMENT_PLAN_NOT_FOUND',
  feeStructureExists: 'FEE_STRUCTURE_EXISTS',
  noFeeStructure: 'NO_FEE_STRUCTURE',
  noPaymentPlan: 'NO_PAYMENT_PLAN',
  invoiceNotFound: 'INVOICE_NOT_FOUND',
  alreadyInvoiced: 'ALREADY_INVOICED',
  enrollmentNotBillable: 'ENROLLMENT_NOT_BILLABLE',
  paymentNotFound: 'PAYMENT_NOT_FOUND',
  invoiceClosed: 'INVOICE_CLOSED',
  overpayment: 'OVERPAYMENT',
  referenceRequired: 'PAYMENT_REFERENCE_REQUIRED',
  unknownProvider: 'UNKNOWN_PAYMENT_PROVIDER',
  unsupportedMethod: 'UNSUPPORTED_PAYMENT_METHOD',
  paymentNotPosted: 'PAYMENT_NOT_POSTED',
  approvalNotFound: 'APPROVAL_NOT_FOUND',
  approvalDecided: 'APPROVAL_ALREADY_DECIDED',
  selfApproval: 'SELF_APPROVAL',
  requestPending: 'REQUEST_ALREADY_PENDING',
  discountTooLarge: 'DISCOUNT_TOO_LARGE',
  codeTaken: 'CODE_TAKEN',
} as const;

// --- fee structures --------------------------------------------------------------------------

export const feeComponentSchema = z.object({
  name: z.string().trim().min(2).max(60),
  amount: positiveMinorUnitsSchema,
});
export type FeeComponent = z.infer<typeof feeComponentSchema>;

export const feeStructureSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  courseId: z.uuid(),
  /** A student category this price applies to; null means everyone. */
  categoryCode: z.string().nullable(),
  effectiveFrom: z.iso.date(),
  currency: z.string(),
  components: z.array(feeComponentSchema),
  total: z.number().int(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type FeeStructure = z.infer<typeof feeStructureSchema>;

/** Prices change by adding a structure with a later date, never by editing one that has been billed. */
export const createFeeStructureRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  courseId: z.uuid(),
  categoryCode: z.string().trim().max(40).nullable().default(null),
  effectiveFrom: z.iso.date(),
  components: z.array(feeComponentSchema).min(1).max(10),
});
export type CreateFeeStructureRequest = z.input<typeof createFeeStructureRequestSchema>;
export type CreateFeeStructureValues = z.output<typeof createFeeStructureRequestSchema>;

export const updateFeeStructureRequestSchema = z
  .object({ name: z.string().trim().min(2).max(120), isActive: z.boolean() })
  .partial();
export type UpdateFeeStructureRequest = z.infer<typeof updateFeeStructureRequestSchema>;

export const feeStructureListQuerySchema = z.object({ courseId: z.uuid().optional() });
export const feeStructureListResponseSchema = z.object({ items: z.array(feeStructureSchema) });
export type FeeStructureListResponse = z.infer<typeof feeStructureListResponseSchema>;

// --- payment plans ---------------------------------------------------------------------------

export const planInstallmentSchema = z.object({
  /** Share of the total, in basis points (2500 = 25 %). */
  shareBp: z.number().int().min(1).max(10_000),
  /** Days after the invoice is issued that this instalment falls due. */
  dueOffsetDays: z.number().int().min(0).max(730),
});
export type PlanInstallment = z.infer<typeof planInstallmentSchema>;

function planIsValid(
  installments: readonly PlanInstallment[],
  ctx: z.RefinementCtx,
  path: (string | number)[] = ['installments'],
) {
  if (installments.reduce((sum, i) => sum + i.shareBp, 0) !== 10_000) {
    ctx.addIssue({ code: 'custom', path, message: 'The shares must add up to 100%.' });
  }
  for (let i = 1; i < installments.length; i += 1) {
    if ((installments[i]?.dueOffsetDays ?? 0) < (installments[i - 1]?.dueOffsetDays ?? 0)) {
      ctx.addIssue({ code: 'custom', path, message: 'Due dates must not go backwards.' });
      break;
    }
  }
}

const installmentsSchema = z.array(planInstallmentSchema).min(1).max(12);

export const paymentPlanSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  installments: z.array(planInstallmentSchema),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type PaymentPlan = z.infer<typeof paymentPlanSchema>;

export const createPaymentPlanRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    installments: installmentsSchema,
    isDefault: z.boolean().default(false),
  })
  .superRefine((value, ctx) => planIsValid(value.installments, ctx));
export type CreatePaymentPlanRequest = z.input<typeof createPaymentPlanRequestSchema>;
export type CreatePaymentPlanValues = z.output<typeof createPaymentPlanRequestSchema>;

export const updatePaymentPlanRequestSchema = z
  .object({ name: z.string().trim().min(2).max(80), isDefault: z.boolean(), isActive: z.boolean() })
  .partial();
export type UpdatePaymentPlanRequest = z.infer<typeof updatePaymentPlanRequestSchema>;

export const paymentPlanListResponseSchema = z.object({ items: z.array(paymentPlanSchema) });
export type PaymentPlanListResponse = z.infer<typeof paymentPlanListResponseSchema>;

// --- invoices --------------------------------------------------------------------------------

export const INVOICE_STATUSES = ['issued', 'partially_paid', 'paid', 'void'] as const;
export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

export const invoiceLineSchema = z.object({ description: z.string(), amount: z.number().int() });
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

/** `overdue` is worked out when the invoice is read: due before today and not fully paid. */
export const installmentStatusSchema = z.enum(['paid', 'partial', 'due', 'overdue']);
export type InstallmentStatus = z.infer<typeof installmentStatusSchema>;

export const installmentSchema = z.object({
  id: z.uuid(),
  sequence: z.number().int(),
  dueDate: z.iso.date(),
  amount: z.number().int(),
  paidAmount: z.number().int(),
  status: installmentStatusSchema,
});
export type Installment = z.infer<typeof installmentSchema>;

export const invoiceSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  studentId: z.uuid(),
  studentName: z.string(),
  studentNumber: z.string(),
  enrollmentId: z.uuid().nullable(),
  branchId: z.uuid(),
  currency: z.string(),
  status: invoiceStatusSchema,
  lines: z.array(invoiceLineSchema),
  subtotal: z.number().int(),
  discountTotal: z.number().int(),
  total: z.number().int(),
  paidTotal: z.number().int(),
  balance: z.number().int(),
  installments: z.array(installmentSchema),
  createdAt: z.iso.datetime(),
  version: z.number().int(),
});
export type Invoice = z.infer<typeof invoiceSchema>;

export const createInvoiceRequestSchema = z.object({
  enrollmentId: z.uuid(),
  /** Which payment plan to split it by; the default plan when omitted. */
  planId: z.uuid().nullable().default(null),
});
export type CreateInvoiceRequest = z.input<typeof createInvoiceRequestSchema>;
export type CreateInvoiceValues = z.output<typeof createInvoiceRequestSchema>;

export const invoiceListQuerySchema = z.object({
  studentId: z.uuid().optional(),
  status: invoiceStatusSchema.optional(),
  /** `unpaid` = issued or partially paid. */
  stage: z.enum(['unpaid', 'settled']).optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

export const invoiceListResponseSchema = z.object({
  items: z.array(invoiceSchema),
  nextCursor: z.string().nullable(),
});
export type InvoiceListResponse = z.infer<typeof invoiceListResponseSchema>;

// --- payments and receipts -------------------------------------------------------------------

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque'] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/** Methods where a slip or cheque number lets the payment be traced later. */
export const METHODS_NEEDING_REFERENCE: readonly PaymentMethod[] = ['bank_transfer', 'cheque'];

export const paymentAllocationSchema = z.object({
  installmentId: z.uuid(),
  sequence: z.number().int(),
  amount: z.number().int(),
});

export const paymentSchema = z.object({
  id: z.uuid(),
  invoiceId: z.uuid(),
  invoiceNumber: z.string(),
  studentId: z.uuid(),
  studentName: z.string(),
  receiptNumber: z.string(),
  branchId: z.uuid(),
  providerKey: z.string(),
  method: paymentMethodSchema,
  reference: z.string().nullable(),
  amount: z.number().int(),
  currency: z.string(),
  status: z.enum(['posted', 'void']),
  receivedAt: z.iso.datetime(),
  voidedAt: z.iso.datetime().nullable(),
  allocations: z.array(paymentAllocationSchema),
  version: z.number().int(),
});
export type Payment = z.infer<typeof paymentSchema>;

export const recordPaymentRequestSchema = z
  .object({
    invoiceId: z.uuid(),
    amount: positiveMinorUnitsSchema,
    method: paymentMethodSchema,
    reference: z
      .union([z.literal(''), z.string().trim().max(60)])
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .default(null),
  })
  .superRefine((value, ctx) => {
    if (METHODS_NEEDING_REFERENCE.includes(value.method) && !value.reference) {
      ctx.addIssue({
        code: 'custom',
        path: ['reference'],
        message: 'Enter the bank slip or cheque number.',
      });
    }
  });
export type RecordPaymentRequest = z.input<typeof recordPaymentRequestSchema>;
export type RecordPaymentValues = z.output<typeof recordPaymentRequestSchema>;

export const paymentListQuerySchema = z.object({
  invoiceId: z.uuid().optional(),
  studentId: z.uuid().optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

export const paymentListResponseSchema = z.object({
  items: z.array(paymentSchema),
  nextCursor: z.string().nullable(),
});
export type PaymentListResponse = z.infer<typeof paymentListResponseSchema>;

// --- approvals (maker-checker) ---------------------------------------------------------------

export const APPROVAL_TYPES = ['discount', 'payment_void'] as const;
export const approvalTypeSchema = z.enum(APPROVAL_TYPES);
export type ApprovalType = z.infer<typeof approvalTypeSchema>;

export const approvalStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalSchema = z.object({
  id: z.uuid(),
  type: approvalTypeSchema,
  status: approvalStatusSchema,
  /** The invoice (for a discount) or payment (for a void) it's about. */
  subjectId: z.uuid(),
  /** One line a decider can read without opening anything: "10% off INV-2026-000012 (ETB 450.00)". */
  summary: z.string(),
  reason: z.string(),
  requestedBy: z.object({ id: z.uuid(), name: z.string() }),
  decidedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  version: z.number().int(),
});
export type Approval = z.infer<typeof approvalSchema>;

export const DISCOUNT_KINDS = ['percent', 'fixed'] as const;

export const requestDiscountSchema = z
  .object({
    kind: z.enum(DISCOUNT_KINDS),
    /** Percent: basis points (1000 = 10 %). Fixed: minor units. */
    value: positiveMinorUnitsSchema,
    reasonCode: z.string().trim().min(1).max(40),
    note: z.string().trim().max(300).default(''),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'percent' && value.value > 10_000) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: "Can't be more than 100%." });
    }
  });
export type RequestDiscount = z.input<typeof requestDiscountSchema>;
export type RequestDiscountValues = z.output<typeof requestDiscountSchema>;

export const requestVoidSchema = z.object({ reason: z.string().trim().min(5).max(300) });
export type RequestVoid = z.infer<typeof requestVoidSchema>;

export const decideApprovalRequestSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(300).default(''),
});
export type DecideApprovalRequest = z.input<typeof decideApprovalRequestSchema>;
export type DecideApprovalValues = z.output<typeof decideApprovalRequestSchema>;

export const approvalListQuerySchema = z.object({
  status: approvalStatusSchema.optional(),
  type: approvalTypeSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ApprovalListQuery = z.infer<typeof approvalListQuerySchema>;

export const approvalListResponseSchema = z.object({
  items: z.array(approvalSchema),
  nextCursor: z.string().nullable(),
});
export type ApprovalListResponse = z.infer<typeof approvalListResponseSchema>;
