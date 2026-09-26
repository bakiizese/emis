# 0004. Server-side sessions, Argon2id and mandatory two-factor for administrators

Status: accepted

## Context

Staff sign in from browsers to a system holding student records and money. The main risks are stolen or guessed passwords,
stolen session tokens, a session that can't be cut off, and probing that reveals which accounts exist. There are no mobile
apps yet and no third parties calling the API.

## Decision

- **Server-side sessions.** After sign-in the browser holds an opaque random token in an `HttpOnly`, `Secure`, `SameSite=Lax`
  cookie named with the `__Host-` prefix (no domain, path `/`). The database stores only a SHA-256 of the token, so a leaked
  database does not yield usable sessions. Sessions expire after inactivity (30 minutes by default) and absolutely (12 hours),
  and can be revoked at once, by the person or by an admin.
- **Argon2id passwords** (19 MiB, 2 iterations, the OWASP minimum) checked with zxcvbn for strength and against the
  person's own details. Sign-in gives the same generic answer and takes comparable time whether or not the account exists.
- **Two-factor.** TOTP with replay protection and single-use recovery codes. The seeds are encrypted at rest with
  AES-256-GCM using a key from the environment, with support for rotating it. Roles can require it, and the built-in Admin
  role does, so an administrator is walked through setup on first sign-in.
- **Progressive lockout and rate limits** per account and per address, and a security-event log the application cannot edit.
- **CSRF** is handled by checking `Origin` and `Sec-Fetch-Site` on every state-changing request, on top of `SameSite`.
- **Staff join by invitation**: a single-use link that expires after 72 hours.

## Consequences

- Good: a session can be revoked instantly, which JWTs cannot do without extra machinery. The token never touches
  JavaScript, so a script injected into a page cannot steal it.
- Good: a breach of the database alone does not hand over sessions, passwords or two-factor secrets (the last need the
  environment key too).
- Bad: every request that needs a session reads the database. Acceptable at this scale, and the session lookup is indexed.
- Bad: the browser apps and the API must share an origin for the cookie to work. Caddy routes both under one address
  (ADR 0011), which also removes CORS.

## Alternatives considered

- **JWT access tokens.** Hard to revoke, and they invite storing tokens where scripts can read them. They will make sense
  for a future mobile app, alongside rotating refresh tokens.
- **An external identity provider.** Adds a dependency each institution would have to run or rent. Revisit if an
  institution wants single sign-on.
- **Passkeys.** A good future addition; TOTP works everywhere today.
