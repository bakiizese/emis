## Summary

<!-- What does this change and why? Link the issue if there is one. -->

## Definition of Done

- [ ] Contract (`packages/contracts`) updated first, if the API changed
- [ ] Tests added: money, seat capacity, idempotency and permissions are always covered
- [ ] Every new route declares a permission (deny by default)
- [ ] Mutations write audit events
- [ ] Migrations reviewed (forward-only, expand/contract)
- [ ] No secrets or personal data in code, logs or fixtures
- [ ] Docs / ADR updated if a decision changed
- [ ] `pnpm check` passes locally

## Test plan

<!-- How did you verify this? Commands run, screenshots for UI changes. -->
