# 0007. Money as whole santim, immutable records, gapless numbers

Status: accepted

## Context

Fees, instalments, payments and receipts are the part of the system people check with a calculator, and the part an auditor
or a sceptical parent will question. Floating-point rounding, a receipt number that goes missing, or a payment that
quietly changes after the fact each destroy trust.

## Decision

- **Money is an integer count of the smallest unit** (santim, 1/100 of a birr) plus a currency code: a `bigint` in the
  database, a whole number in the contracts, and integer-only maths in code. There are no floats anywhere. Splitting a
  total across instalments by shares in basis points always adds back to the exact total, and that and every allocation rule
  are property-tested with fast-check.
- **Totals are recomputed, not stored twice.** After any change to instalments the invoice's paid amount, status and totals
  are recomputed from them (`settle()`), so an invoice cannot disagree with its parts.
- **Payments pay the oldest instalment first,** refuse an overpayment, and take the invoice's row lock so twenty clerks
  racing for one invoice get exactly the payments that fit.
- **Recorded money is immutable.** The API's database role cannot delete or truncate money tables or update allocations,
  and triggers (`emis_forbid_column_changes`) refuse changes to an amount, number, date or line item. Only status and running
  totals move, and only through the services that move them together.
- **Corrections are reversals.** Voiding a payment reverses its effect but keeps the receipt number it used, and needs a
  second person's approval (ADR 0005). Discounts also need approval and cut the latest instalments first.
- **Numbers are gapless.** Invoice, receipt, student and application numbers come from counters (per series, branch or fiscal
  year as the pattern says) locked in the same transaction that stores the record, so concurrent issuers queue and a
  rolled-back transaction gives its number back.
- **Reports read the same rows.** Revenue and outstanding balances are computed by the database from payments and
  instalments, never from separate tallies (a test checks the revenue total equals what the invoices say was paid).

## Consequences

- Good: arithmetic that is exact and explainable, and records that cannot be edited to hide something, even by a bug or by
  someone with the application's credentials.
- Good: a missing receipt number is a signal, not an accident, because the sequence has no holes to explain.
- Bad: no editing a wrong payment; it must be voided and re-entered, which is slower and is the point.
- Bad: the gapless counter serializes issuing within a series. At one institution's volume this is invisible.
- Not done: a full double-entry ledger, revenue recognition and payroll. Reports work from invoices and payments, which is
  enough for collections and aging today; a ledger can be built on the same immutable records later.

## Alternatives considered

- **Decimal or floating-point money.** Rounding surprises, and mixing currencies with no type to stop it.
- **A mutable payments table with an edit history.** Cheaper to build, much weaker as evidence.
- **Database sequences for receipt numbers.** They leave gaps whenever a transaction rolls back.
