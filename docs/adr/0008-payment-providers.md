# 0008. Payments go through a provider interface; only manual payments exist today

Status: accepted

## Context

The first institution takes cash and bank transfers at the front desk. Other markets, and later this one, will want online
payment through a gateway (a mobile-money service, a card processor). Online gateways bring webhooks, redirects, retries
and reconciliation, which are a lot to build before anyone needs them.

## Decision

Payments are taken through a `PaymentProvider` interface and a registry. Only the **Manual provider** exists: cash, bank
transfer and cheque, where the front desk records what was received (and a reference for transfers and cheques). Allocation
to instalments, receipt numbering, voids and reports know nothing about how the money arrived, so an online provider
later plugs in without touching them.

When an online provider is added, the design already settled here holds: never trust a redirect or a webhook alone, always
confirm with the provider's own verify call; record the provider's event id under a unique key so a repeated webhook is
harmless; and post the payment, its allocation and its receipt number in one transaction.

## Consequences

- Good: the money code is small and fully tested for the case that exists, with an extension point that is real rather than
  speculative.
- Good: no gateway credentials, webhook endpoint or reconciliation job to secure until an institution asks for them.
- Bad: no self-service online payment yet. Students pay at the desk.

## Alternatives considered

- **Build a gateway integration now.** Unused code is still code to secure and maintain, and the details depend on which
  gateway an institution picks.
- **Hard-code cash as the only kind of payment.** Cheaper today, and a rewrite of allocation and receipts tomorrow.
