import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  allocatePayment,
  applyDiscount,
  buildInstallments,
  discountAmount,
  type InstallmentState,
  installmentStatusFor,
  invoiceStatusFor,
} from './money-flow.js';

const plan = [
  { shareBp: 5000, dueOffsetDays: 0 },
  { shareBp: 3000, dueOffsetDays: 30 },
  { shareBp: 2000, dueOffsetDays: 60 },
];

describe('buildInstallments', () => {
  it('splits the total by the plan and dates each one from the issue date', () => {
    expect(buildInstallments(10001, plan, '2026-09-30')).toEqual([
      { sequence: 1, dueDate: '2026-09-30', amount: 5000 },
      { sequence: 2, dueDate: '2026-10-30', amount: 3000 },
      { sequence: 3, dueDate: '2026-11-29', amount: 2001 },
    ]);
  });
});

/** Instalments with arbitrary amounts, due dates and amounts already paid. */
const installmentsArb = fc
  .array(
    fc.record({
      amount: fc.integer({ min: 0, max: 1_000_000 }),
      paidFraction: fc.double({ min: 0, max: 1, noNaN: true }),
      day: fc.integer({ min: 1, max: 28 }),
    }),
    { minLength: 1, maxLength: 8 },
  )
  .map((rows): InstallmentState[] =>
    rows.map((r, i) => ({
      id: `i${i}`,
      sequence: i + 1,
      dueDate: `2026-09-${String(r.day).padStart(2, '0')}`,
      amount: r.amount,
      paidAmount: Math.floor(r.amount * r.paidFraction),
    })),
  );

const owedTotal = (list: InstallmentState[]) =>
  list.reduce((sum, i) => sum + i.amount - i.paidAmount, 0);

describe('allocatePayment', () => {
  const base: InstallmentState[] = [
    { id: 'late', sequence: 2, dueDate: '2026-11-01', amount: 4000, paidAmount: 0 },
    { id: 'early', sequence: 1, dueDate: '2026-10-01', amount: 6000, paidAmount: 1000 },
  ];

  it('pays the oldest due first and moves on when one is settled', () => {
    expect(allocatePayment(base, 3000)).toEqual({
      allocations: [{ installmentId: 'early', amount: 3000 }],
      remainder: 0,
    });
    expect(allocatePayment(base, 7000)).toEqual({
      allocations: [
        { installmentId: 'early', amount: 5000 },
        { installmentId: 'late', amount: 2000 },
      ],
      remainder: 0,
    });
  });

  it('returns what does not fit, and skips settled instalments', () => {
    const settled = [
      { id: 'done', sequence: 1, dueDate: '2026-10-01', amount: 500, paidAmount: 500 },
      ...base,
    ];
    expect(allocatePayment(settled, 20000).remainder).toBe(20000 - 9000);
    expect(allocatePayment(settled, 20000).allocations.map((a) => a.installmentId)).toEqual(
      ['done', 'early', 'late'].filter((x) => x !== 'done'),
    );
  });

  it('never loses or invents a santim, and never overpays an instalment', () => {
    fc.assert(
      fc.property(
        installmentsArb,
        fc.integer({ min: 0, max: 5_000_000 }),
        (installments, amount) => {
          const { allocations, remainder } = allocatePayment(installments, amount);
          const allocated = allocations.reduce((sum, a) => sum + a.amount, 0);
          expect(allocated + remainder).toBe(amount);
          expect(allocated).toBeLessThanOrEqual(owedTotal(installments));
          for (const a of allocations) {
            const target = installments.find((i) => i.id === a.installmentId)!;
            expect(a.amount).toBeGreaterThan(0);
            expect(a.amount).toBeLessThanOrEqual(target.amount - target.paidAmount);
          }
          // Everything owed is covered before any remainder is left.
          if (remainder > 0) expect(allocated).toBe(owedTotal(installments));
        },
      ),
    );
  });

  it('pays instalments in due-date order', () => {
    fc.assert(
      fc.property(
        installmentsArb,
        fc.integer({ min: 1, max: 5_000_000 }),
        (installments, amount) => {
          const { allocations } = allocatePayment(installments, amount);
          const order = allocations.map((a) => installments.find((i) => i.id === a.installmentId)!);
          for (let k = 1; k < order.length; k += 1) {
            expect(
              `${order[k - 1]!.dueDate}${order[k - 1]!.sequence}` <=
                `${order[k]!.dueDate}${order[k]!.sequence}`,
            ).toBe(true);
          }
          // Only the last one touched may be left partly unpaid.
          for (const a of allocations.slice(0, -1)) {
            const i = installments.find((x) => x.id === a.installmentId)!;
            expect(i.paidAmount + a.amount).toBe(i.amount);
          }
        },
      ),
    );
  });
});

describe('applyDiscount', () => {
  it('cuts the latest instalments first and leaves paid money alone', () => {
    const list: InstallmentState[] = [
      { id: 'a', sequence: 1, dueDate: '2026-10-01', amount: 5000, paidAmount: 5000 },
      { id: 'b', sequence: 2, dueDate: '2026-11-01', amount: 3000, paidAmount: 1000 },
      { id: 'c', sequence: 3, dueDate: '2026-12-01', amount: 2000, paidAmount: 0 },
    ];
    expect(applyDiscount(list, 2500)).toEqual([
      { installmentId: 'c', newAmount: 0 },
      { installmentId: 'b', newAmount: 2500 },
    ]);
  });

  it('refuses a discount bigger than what is unpaid', () => {
    expect(() =>
      applyDiscount(
        [{ id: 'a', sequence: 1, dueDate: '2026-10-01', amount: 100, paidAmount: 40 }],
        61,
      ),
    ).toThrow();
  });

  it('removes exactly the discount and never goes below what was paid', () => {
    fc.assert(
      fc.property(
        installmentsArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (installments, fraction) => {
          const unpaid = owedTotal(installments);
          const amount = Math.floor(unpaid * fraction);
          const changes = applyDiscount(installments, amount);
          const after = installments.map((i) => ({
            ...i,
            amount: changes.find((c) => c.installmentId === i.id)?.newAmount ?? i.amount,
          }));
          expect(
            installments.reduce((s, i) => s + i.amount, 0) -
              after.reduce((s, i) => s + i.amount, 0),
          ).toBe(amount);
          for (const i of after) {
            expect(i.amount).toBeGreaterThanOrEqual(i.paidAmount);
            expect(i.amount).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });
});

describe('discountAmount', () => {
  it('takes a share of the current total, rounded down, or a fixed amount', () => {
    expect(discountAmount('percent', 1000, 450000)).toBe(45000);
    expect(discountAmount('percent', 3333, 1000)).toBe(333);
    expect(discountAmount('percent', 10000, 999_999_999_999)).toBe(999_999_999_999);
    expect(discountAmount('fixed', 25000, 450000)).toBe(25000);
    // A sliver of a small total rounds to nothing; the service refuses that as too small.
    expect(discountAmount('percent', 1, 5000)).toBe(0);
  });
});

describe('statuses', () => {
  it('derives the invoice status from what is paid', () => {
    expect(invoiceStatusFor(1000, 0)).toBe('issued');
    expect(invoiceStatusFor(1000, 1)).toBe('partially_paid');
    expect(invoiceStatusFor(1000, 1000)).toBe('paid');
    expect(invoiceStatusFor(0, 0)).toBe('paid');
  });

  it('marks an instalment overdue only when it is unpaid and past due', () => {
    const inst = { amount: 1000, paidAmount: 0, dueDate: '2026-09-01' };
    expect(installmentStatusFor(inst, '2026-09-01')).toBe('due');
    expect(installmentStatusFor(inst, '2026-09-02')).toBe('overdue');
    expect(installmentStatusFor({ ...inst, paidAmount: 400 }, '2026-09-02')).toBe('overdue');
    expect(installmentStatusFor({ ...inst, paidAmount: 400 }, '2026-08-30')).toBe('partial');
    expect(installmentStatusFor({ ...inst, paidAmount: 1000 }, '2027-01-01')).toBe('paid');
  });
});
