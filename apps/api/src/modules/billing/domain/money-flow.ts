import {
  type InstallmentStatus,
  type InvoiceStatus,
  type PlanInstallment,
  splitByBasisPoints,
} from '@emis/contracts';

import { addDays } from '../../../common/dates.js';

export interface InstallmentState {
  id: string;
  sequence: number;
  dueDate: string;
  amount: number;
  paidAmount: number;
}

const owed = (i: InstallmentState) => i.amount - i.paidAmount;
const byDueDate = (a: InstallmentState, b: InstallmentState) =>
  a.dueDate.localeCompare(b.dueDate) || a.sequence - b.sequence;

/** Instalments for a new invoice: the total split by the plan's shares, due `offset` days after issue. */
export function buildInstallments(
  total: number,
  plan: readonly PlanInstallment[],
  issueDate: string,
): { sequence: number; dueDate: string; amount: number }[] {
  const amounts = splitByBasisPoints(
    total,
    plan.map((p) => p.shareBp),
  );
  return plan.map((p, i) => ({
    sequence: i + 1,
    dueDate: addDays(issueDate, p.dueOffsetDays),
    amount: amounts[i] ?? 0,
  }));
}

export interface Allocation {
  installmentId: string;
  amount: number;
}

/**
 * Apply a payment to the instalments, oldest due first, each up to what it still owes. Anything
 * left over (more than the invoice owes) is returned as `remainder` for the caller to refuse.
 */
export function allocatePayment(
  installments: readonly InstallmentState[],
  amount: number,
): { allocations: Allocation[]; remainder: number } {
  const allocations: Allocation[] = [];
  let left = amount;
  for (const installment of [...installments].sort(byDueDate)) {
    if (left === 0) break;
    const take = Math.min(left, owed(installment));
    if (take > 0) {
      allocations.push({ installmentId: installment.id, amount: take });
      left -= take;
    }
  }
  return { allocations, remainder: left };
}

/**
 * Reduce the unpaid instalments by `amount`, taking from the latest due date first and never below
 * what's already been paid, so a discount doesn't disturb what's due soonest. `amount` must not
 * exceed what's unpaid (the caller checks); returns the new amount for each changed instalment.
 */
export function applyDiscount(
  installments: readonly InstallmentState[],
  amount: number,
): { installmentId: string; newAmount: number }[] {
  const changes: { installmentId: string; newAmount: number }[] = [];
  let left = amount;
  for (const installment of [...installments].sort(byDueDate).reverse()) {
    if (left === 0) break;
    const cut = Math.min(left, owed(installment));
    if (cut > 0) {
      changes.push({ installmentId: installment.id, newAmount: installment.amount - cut });
      left -= cut;
    }
  }
  if (left > 0) throw new Error('Discount is larger than what is unpaid');
  return changes;
}

/** What a percentage or fixed discount comes to, in minor units, on an invoice's current total. */
export function discountAmount(
  kind: 'percent' | 'fixed',
  value: number,
  currentTotal: number,
): number {
  return kind === 'fixed' ? value : Number((BigInt(currentTotal) * BigInt(value)) / 10_000n);
}

export function invoiceStatusFor(total: number, paid: number): Exclude<InvoiceStatus, 'void'> {
  if (paid >= total) return 'paid';
  return paid > 0 ? 'partially_paid' : 'issued';
}

export function installmentStatusFor(
  installment: Pick<InstallmentState, 'amount' | 'paidAmount' | 'dueDate'>,
  today: string,
): InstallmentStatus {
  if (installment.paidAmount >= installment.amount) return 'paid';
  if (installment.dueDate < today) return 'overdue';
  return installment.paidAmount > 0 ? 'partial' : 'due';
}
