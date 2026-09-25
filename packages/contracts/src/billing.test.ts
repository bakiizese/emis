import { describe, expect, it } from 'vitest';

import {
  createFeeStructureRequestSchema,
  createPaymentPlanRequestSchema,
  decideApprovalRequestSchema,
  recordPaymentRequestSchema,
  requestDiscountSchema,
  requestVoidSchema,
} from './billing.js';

const id = '0199a1b2-0000-7000-8000-000000000001';

describe('fee structures', () => {
  it('needs at least one priced component, in whole santim', () => {
    const base = { name: 'A2 fees', courseId: id, effectiveFrom: '2026-09-01' };
    expect(createFeeStructureRequestSchema.safeParse({ ...base, components: [] }).success).toBe(
      false,
    );
    expect(
      createFeeStructureRequestSchema.safeParse({
        ...base,
        components: [{ name: 'Tuition', amount: 12.5 }],
      }).success,
    ).toBe(false);
    expect(
      createFeeStructureRequestSchema.safeParse({
        ...base,
        components: [{ name: 'Tuition', amount: 0 }],
      }).success,
    ).toBe(false);
    const ok = createFeeStructureRequestSchema.parse({
      ...base,
      components: [{ name: 'Tuition', amount: 450000 }],
    });
    expect(ok.categoryCode).toBeNull();
  });
});

describe('payment plans', () => {
  it('needs shares that add up to exactly 100% and due dates that never go back', () => {
    const plan = (installments: object[]) =>
      createPaymentPlanRequestSchema.safeParse({ name: 'Plan', installments });
    expect(plan([{ shareBp: 10000, dueOffsetDays: 0 }]).success).toBe(true);
    expect(
      plan([
        { shareBp: 5000, dueOffsetDays: 0 },
        { shareBp: 5000, dueOffsetDays: 30 },
      ]).success,
    ).toBe(true);
    expect(
      plan([
        { shareBp: 5000, dueOffsetDays: 0 },
        { shareBp: 4000, dueOffsetDays: 30 },
      ]).success,
    ).toBe(false);
    expect(
      plan([
        { shareBp: 5000, dueOffsetDays: 30 },
        { shareBp: 5000, dueOffsetDays: 0 },
      ]).success,
    ).toBe(false);
    expect(plan([]).success).toBe(false);
  });
});

describe('payments', () => {
  it('needs a slip or cheque number for anything but cash', () => {
    const base = { invoiceId: id, amount: 100000 };
    expect(recordPaymentRequestSchema.safeParse({ ...base, method: 'cash' }).success).toBe(true);
    expect(recordPaymentRequestSchema.safeParse({ ...base, method: 'bank_transfer' }).success).toBe(
      false,
    );
    expect(
      recordPaymentRequestSchema.safeParse({ ...base, method: 'cheque', reference: '  ' }).success,
    ).toBe(false);
    expect(
      recordPaymentRequestSchema.parse({ ...base, method: 'cheque', reference: ' 004512 ' })
        .reference,
    ).toBe('004512');
  });

  it('rejects zero, negative and fractional amounts', () => {
    for (const amount of [0, -5, 10.5]) {
      expect(
        recordPaymentRequestSchema.safeParse({ invoiceId: id, amount, method: 'cash' }).success,
      ).toBe(false);
    }
  });
});

describe('approvals', () => {
  it('caps a percentage discount at 100%', () => {
    expect(
      requestDiscountSchema.safeParse({ kind: 'percent', value: 10000, reasonCode: 'sibling' })
        .success,
    ).toBe(true);
    expect(
      requestDiscountSchema.safeParse({ kind: 'percent', value: 10001, reasonCode: 'sibling' })
        .success,
    ).toBe(false);
    expect(
      requestDiscountSchema.safeParse({ kind: 'fixed', value: 500000, reasonCode: 'sibling' })
        .success,
    ).toBe(true);
  });

  it('asks for a real reason to void, and a decision to be made', () => {
    expect(requestVoidSchema.safeParse({ reason: 'oops' }).success).toBe(false);
    expect(requestVoidSchema.safeParse({ reason: 'Recorded twice by mistake' }).success).toBe(true);
    expect(decideApprovalRequestSchema.safeParse({ decision: 'maybe' }).success).toBe(false);
    expect(decideApprovalRequestSchema.parse({ decision: 'approve' }).note).toBe('');
  });
});
