import { z } from 'zod';

export const REPORT_ERROR_CODES = {
  invalidRange: 'INVALID_DATE_RANGE',
  rangeTooLarge: 'DATE_RANGE_TOO_LARGE',
} as const;

const dateSchema = z.iso.date();

// --- revenue ---------------------------------------------------------------------------------

export const REVENUE_GROUPINGS = [
  'day',
  'month',
  'branch',
  'department',
  'program',
  'method',
] as const;
export const revenueGroupingSchema = z.enum(REVENUE_GROUPINGS);
export type RevenueGrouping = z.infer<typeof revenueGroupingSchema>;

/** Longest span a report may cover; the same for every grouping so results stay quick. */
export const MAX_REPORT_DAYS = 1100;

export const revenueQuerySchema = z.object({
  /** First day, inclusive. Defaults to the first of the current month. */
  from: dateSchema.optional(),
  /** Last day, inclusive. Defaults to today. */
  to: dateSchema.optional(),
  groupBy: revenueGroupingSchema.default('day'),
  branchId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  method: z.enum(['cash', 'bank_transfer', 'cheque']).optional(),
});
export type RevenueQuery = z.input<typeof revenueQuerySchema>;
export type RevenueValues = z.output<typeof revenueQuerySchema>;

export const revenueRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** Payments received. */
  count: z.number().int(),
  /** Whole santim. */
  amount: z.number().int(),
});
export type RevenueRow = z.infer<typeof revenueRowSchema>;

export const revenueResponseSchema = z.object({
  from: dateSchema,
  to: dateSchema,
  groupBy: revenueGroupingSchema,
  currency: z.string(),
  rows: z.array(revenueRowSchema),
  totals: z.object({
    count: z.number().int(),
    amount: z.number().int(),
    /** Payments that were voided in the same filter: shown so the totals can be reconciled, never counted in `amount`. */
    voidedCount: z.number().int(),
    voidedAmount: z.number().int(),
  }),
});
export type RevenueResponse = z.infer<typeof revenueResponseSchema>;

// --- outstanding balances (aging) ------------------------------------------------------------

export const AGING_BUCKETS = ['not_due', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
export const agingBucketSchema = z.enum(AGING_BUCKETS);
export type AgingBucket = z.infer<typeof agingBucketSchema>;

export const AGING_LABELS: Record<AgingBucket, string> = {
  not_due: 'Not yet due',
  d1_30: '1–30 days overdue',
  d31_60: '31–60 days overdue',
  d61_90: '61–90 days overdue',
  d90_plus: 'Over 90 days overdue',
};

/** Which bucket an instalment falls in, from the number of days past its due date. */
export function agingBucketFor(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'not_due';
  if (daysOverdue <= 30) return 'd1_30';
  if (daysOverdue <= 60) return 'd31_60';
  if (daysOverdue <= 90) return 'd61_90';
  return 'd90_plus';
}

export const outstandingQuerySchema = z.object({
  /** The day to measure against. Defaults to today. */
  asOf: dateSchema.optional(),
  branchId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
});
export type OutstandingQuery = z.infer<typeof outstandingQuerySchema>;

export const agingRowSchema = z.object({
  bucket: agingBucketSchema,
  label: z.string(),
  /** Unpaid instalments in this bucket. */
  count: z.number().int(),
  amount: z.number().int(),
});

export const outstandingResponseSchema = z.object({
  asOf: dateSchema,
  currency: z.string(),
  buckets: z.array(agingRowSchema),
  totals: z.object({
    count: z.number().int(),
    amount: z.number().int(),
    overdueCount: z.number().int(),
    overdueAmount: z.number().int(),
  }),
});
export type OutstandingResponse = z.infer<typeof outstandingResponseSchema>;

export const outstandingItemsQuerySchema = outstandingQuerySchema.extend({
  bucket: agingBucketSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type OutstandingItemsQuery = z.infer<typeof outstandingItemsQuerySchema>;

export const outstandingItemSchema = z.object({
  installmentId: z.uuid(),
  invoiceId: z.uuid(),
  invoiceNumber: z.string(),
  studentId: z.uuid(),
  studentNumber: z.string(),
  studentName: z.string(),
  branchId: z.uuid(),
  sequence: z.number().int(),
  dueDate: dateSchema,
  /** Still to pay on this instalment, in santim. */
  owed: z.number().int(),
  daysOverdue: z.number().int(),
  bucket: agingBucketSchema,
});
export type OutstandingItem = z.infer<typeof outstandingItemSchema>;

export const outstandingItemsResponseSchema = z.object({
  items: z.array(outstandingItemSchema),
  nextCursor: z.string().nullable(),
});
export type OutstandingItemsResponse = z.infer<typeof outstandingItemsResponseSchema>;
