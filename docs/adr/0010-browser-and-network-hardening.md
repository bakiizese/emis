# 0010. A nonce-based content security policy and an inventory of anonymous routes

Status: accepted

## Context

The website takes input from the public and the portal shows personal data, so a cross-site scripting bug in either is the
highest-impact class of vulnerability. Separately, every endpoint reachable without signing in is a door open to the
internet, and doors get added without anyone deciding to.

## Decision

- **A strict Content Security Policy on both Next.js apps,** with a fresh random nonce on every response: only scripts
  carrying that nonce run (`strict-dynamic`), there is no inline or eval'd script in production, no framing, no plugins,
  forms and connections only to the site's own origin, and https is forced. Both apps build the header with one shared
  function so they cannot drift, and render pages per request so the nonce can be stamped on them. Standard companions are
  sent too: `nosniff`, a strict referrer policy, a locked-down permissions policy, cross-origin opener isolation, and HSTS.
- **A safety valve, not a loophole.** `CSP_REPORT_ONLY=true` makes the browser report violations instead of blocking them,
  for diagnosing a page that misbehaves.
- **Proved in a real browser.** The end-to-end suite runs the production builds under this policy, fails on any policy
  violation or uncaught page error, and checks that injected markup with an event handler or a `javascript:` link does not
  run and that the pages cannot be framed.
- **API responses default to `Cache-Control: no-store`**, and the API has its own locked-down policy, HSTS and a CORS list
  that is closed by default.
- **An inventory of anonymous routes.** A test lists every endpoint that needs no sign-in with the reason it may be
  public, and fails if one appears that is not on the list. It also fails if an anonymous route that takes a secret or changes
  something has no rate limit of its own.
- **Dependencies are watched.** CI audits them (`pnpm audit`, Trivy, dependency review) on every change and weekly.

## Consequences

- Good: an injected `<script>` or handler is refused by the browser even if some page has an escaping bug, and a new open
  route cannot slip in unreviewed.
- Bad: the policy constrains how the frontends are written: no inline scripts, no external script hosts, no
  `dangerouslySetInnerHTML` except the escaped structured-data tag, and pages cannot be statically prerendered.
- Bad: `strict-dynamic` trusts scripts that a nonce'd script creates on purpose. It defends against injected markup, which
  is the realistic attack, not against a script that is already running.
- Bad: style attributes (a bar's width, the brand colour) are allowed inline because they cannot run code.

## Alternatives considered

- **A host allow-list policy.** Easier to write, easier to bypass, and it breaks whenever a host changes.
- **Only sanitizing output.** Necessary and not sufficient; the policy is the second line when the first line has a hole.
