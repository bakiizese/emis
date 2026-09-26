# 0001. One install per institution, one modular monolith, configuration over code

Status: accepted

## Context

EMIS is built first for one institution (a language and computer training center in Ethiopia) but meant to be a product
other training institutions can install on their own server. Those institutions differ: one teaches only English, another
runs Language, Computer, Music and Tutoring, with different shifts, rooms, fees and words for things ("class" or "batch").
The team is small, servers are modest, and many of these institutions want their data on a machine they control.

## Decision

- **Single tenant.** Every institution runs its own copy of the whole system with its own database. There is no tenant
  column and no shared database.
- **Configuration, not forks.** What differs between institutions lives in data an administrator edits from the portal:
  departments, programs, shifts, rooms, fee structures, module switches, dropdown lists, custom fields, terminology
  overrides and numbering patterns. Code never mentions an institution, a department or a course by name.
- **One deployable, split into modules.** The API is a NestJS modular monolith. Each module has `domain/`,
  `application/`, `infrastructure/` and `interface/` folders and a public `index.ts`; other modules may import only that
  file. `pnpm deps:check` fails the build on a violation. A separate worker process (same code, different entry point) runs
  background jobs.

## Consequences

- Good: installing, upgrading, backing up and reasoning about one institution is simple. There is no cross-tenant data leak
  to design against, and each install can be sized and secured for its owner.
- Good: modules can be understood and tested one at a time, and could be extracted into services later if a real need
  appeared. Until then there is no network between them to fail.
- Bad: every institution has to be upgraded separately, and improvements do not reach everyone at once. Mitigated by
  signed, versioned images and migrations that apply themselves (ADR 0011).
- Bad: a feature that only one institution needs still lives in the shared code unless it can be a configuration option.
  New optional features get a module switch (`@RequiresModule`) so an install can turn them off entirely.

## Alternatives considered

- **Multi-tenant SaaS.** One shared system with a tenant per institution. Cheaper to run at scale, but institutions want
  their own server, and one missed tenant filter would expose another institution's students. The risk is not worth it for
  the size of this product.
- **A fork or code change per institution.** Fast for the first customer, ruinous for the second. Rejected at the start.
- **Microservices.** No team or scale that needs them, and a distributed system is harder to run on one small server.
