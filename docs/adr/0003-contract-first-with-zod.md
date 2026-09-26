# 0003. Contract first: one Zod schema for the API and both frontends

Status: accepted

## Context

The API, the staff portal and the public website all send and receive the same data. When each keeps its own idea of a
request or response, they drift: a field is renamed on one side, a validation rule differs, a screen shows a value the API
no longer sends. In a system that handles money and personal data, quiet drift becomes a bug in production.

## Decision

Every endpoint starts as a Zod schema in `packages/contracts`. The API validates requests with it (a `ZodValidationPipe`
on every body and query), describes the endpoint in its OpenAPI page from the same schema, and returns data shaped by it.
The portal and the website import the same schemas and types: forms validate with them, and responses are parsed with them,
so a mismatch fails loudly in development and in tests rather than showing up as a blank field.

Errors follow RFC 9457 (`application/problem+json`) with a stable machine-readable `code` (`ENROLLMENT_COHORT_FULL`,
`VERSION_CONFLICT`). Frontends switch on the code, never on the wording. Validation errors carry per-field messages.

## Consequences

- Good: a change to a contract is a compile error in every place that uses it. Tests can parse responses with the same
  schema the frontend uses.
- Good: the website's forms give the same answers as the API's validation because they run the same code.
- Bad: contracts are a package everything depends on, so a careless change ripples. That is the intended trade: the
  ripple shows up at build time.
- Bad: Zod 4 has sharp edges (a defaulted field inside `.partial()` still gets its default), captured in the contributor
  notes and covered by tests.

## Alternatives considered

- **Generate types from the API (OpenAPI codegen).** Works, but the direction is backwards: the schema that validates at
  runtime should be the source, not a description generated from code.
- **Separate types per app.** The drift described above.
