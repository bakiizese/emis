# 0005. Permissions in code, roles as data, deny by default, a second pair of eyes

Status: accepted

## Context

A secretary at one branch, a coordinator for one department and an administrator need different access. Institutions want to
change who can do what. The worst failures are a route that forgot its check, and a person who can reach records of a branch
or department that is not theirs.

## Decision

- **A permission catalog in code** (`packages/permissions`), named `area.action` (`billing.receive`, `certificates.revoke`).
  Adding a permission is a code change; using one is a database change.
- **Roles are data.** The four built-in roles (Admin, Coordinator, Secretary, Instructor) are defined in code and synced
  into the database on every migration, so a new permission reaches every install on upgrade. A role assignment carries a
  scope: institution-wide, one branch or one department.
- **Deny by default.** Every route must declare exactly one of `@Public()`, `@SelfService()` or `@RequirePermission(...)`;
  a route with none is refused at runtime and fails a test that enumerates every route. A second test lists every anonymous
  route with its reason and fails when one appears without being approved (ADR 0010).
- **Two levels of checking.** The guard proves the caller holds the permission somewhere. The service then checks the
  record's own branch or department with `assertScope` after loading it, and list queries are filtered to what the caller's
  grants reach, so asking for another branch's records does not work around a limit.
- **An authorization matrix test** runs every role against every protected endpoint and expects allow or deny.
- **Maker and checker.** A discount or a void is requested by one person and takes effect only when a different person
  approves. The service enforces it and so does the database (the decider cannot be the requester; a decided request is
  final).

## Consequences

- Good: forgetting a check is caught by CI, not by an incident. Scope limits hold even when a caller adds filters.
- Good: institutions can change what a role does without a release, and add roles of their own.
- Bad: every endpoint and every permission needs a row in the matrix test. That is friction on purpose.
- Bad: with a single administrator, a second approver does not exist. The design leaves room for a step-up policy for that
  case (an administrator approving with two-factor and a recorded reason); it is not built.

## Alternatives considered

- **CASL abilities built per request.** Expressive, but the checks would be spread over the code as rules rather than one
  list a test can compare against.
- **Access lists per record.** Precise and unmanageable.
- **Hard-coded roles.** Simple until the first institution wants a different secretary.
