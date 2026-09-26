# EMIS

A configurable, self-hosted **Education Management Information System** for training institutions:
public website, student information system, finance and an admin dashboard on one backend.

Each institution runs its own install and configures it for what it teaches: a single English
program, or several departments (Language, Computer, Music, Tutoring…) with their own programs,
shifts, rooms and fees.

> Status: early development. First deployment: Lingua Computer and Language Institute.

## Architecture

| Part                 | Tech                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/api`           | NestJS 12 on Fastify, modular monolith, REST under `/api/v1`; `src/worker.ts` runs background jobs |
| `apps/portal`        | Next.js 16 staff portal (admin dashboard, SIS, finance)                                            |
| `apps/web`           | Next.js 16 public website                                                                          |
| `packages/contracts` | Zod schemas shared by backend and frontends                                                        |
| `packages/ui`        | Design system (Tailwind CSS v4, shadcn/ui style)                                                   |
| Data                 | PostgreSQL 18, Valkey (cache and queues), S3 object storage, Gotenberg (PDF)                       |

## Getting started

Requirements: Node 24 (`nvm use`), Docker, corepack.

```bash
corepack enable          # provides the pinned pnpm version
pnpm install
cp .env.example .env     # then set the passwords
pnpm infra:up            # Postgres, Valkey, S3, Gotenberg, Mailpit
pnpm db:bootstrap        # once: creates the database roles (safe to re-run)
pnpm db:migrate          # applies migrations
pnpm --filter @emis/api account:create-admin   # first admin, or grant Admin to an existing account
pnpm dev                 # api :4000 + worker · web :3000 · portal :3001
```

Set `ENCRYPTION_KEY` in `.env` first (`openssl rand -base64 32`). Then sign in at
http://localhost:3001/login, where the admin is walked through authenticator-app setup and then the
first-run setup wizard (institution details, branches, departments).

- API health: `curl http://localhost:4000/api/v1/health` (readiness: `/api/v1/health/ready`)
- API reference: http://localhost:4000/api/docs
- Outgoing email in dev: http://localhost:8025

### Institution setup

Nothing about an institution is hard-coded. An admin configures it from the portal:

- **Setup wizard** on first sign-in: profile, branding, currency, time zone, fiscal year, branches, and
  departments from starting packs (Language, Computer, Tutoring) or their own
- **Branches and departments**, which roles can be limited to (a Secretary at one campus, a Coordinator
  for one department)
- **Module switches** (website, pre-registration, placement, certificates…). A switched-off module's
  routes answer 404 and its screens disappear
- **Dropdown lists, custom fields and terminology** (call a cohort a "Batch") without code changes
- **Numbering patterns** like `RCP-{BRANCH}-{FY}-{SEQ:6}`, issued from gapless counters: concurrent
  issuers queue on a row lock, and a rolled-back transaction gives its number back
- Settings changes need `If-Match` with the version you read, so two admins can't silently overwrite
  each other (412 on conflict), and every change lands in the audit log

### Academic catalog

- **Programs and courses** under each department (e.g. English → A1, A2, B1…), with prerequisites
  and completion rules (minimum attendance %, pass mark, whether it earns a certificate). Prerequisites
  stay inside one program and can't form a loop, even when two people edit at the same moment
- **Academic calendar:** academic years (the database refuses overlapping ranges), intake windows with
  registration open/close times, and holidays that apply to every branch or just one
- **Shifts** (days of the week + time window) and **rooms** with seats and features per branch
- A Coordinator limited to one department can edit only that department's programs and courses;
  everything else here is Admin-only. Every staff role can read the catalog

### Students and admissions

- **Student records** with Ethiopian-style names (first, father's, grandfather's), a normalized phone
  ("0911 22 33 44" and "+251 911-223344" are the same number), guardians (one main contact, one payer),
  the institution's own categories and custom fields, and numbers from the configurable pattern
- **Search** by name words in any order, student number or part of a phone, on a trigram index; lists page with keyset cursors
- **Duplicate detection** before registering: same phone, same email or a near-identical name (typos
  included), across every branch. It stops the registration until someone confirms it's a different person
- **Admissions pipeline:** submitted → contacted → placement scheduled → placed → offered → confirmed → enrolled,
  with rejected / withdrawn / expired exits, as a small state machine. A placement result recommends a
  starting level and is limited by department; registering an offered applicant as a student is one locked
  step, so a double click makes one student, not two
- A Secretary is limited to their branch's students and applicants. Audit entries say what changed and
  by whom, never the person's details

### Cohorts and enrollment

- **Cohorts** are scheduled classes: a course in a shift and room, with an instructor and a date range.
  Sessions are generated from the shift's days, skipping holidays, at the institution's clock time
- **No double-booking, enforced by Postgres:** an EXCLUDE constraint refuses two sessions that overlap
  in the same room or with the same instructor (back-to-back is fine). The API turns it into a clear
  409, and a cohort that clashes leaves nothing behind
- **Seats:** a cohort takes the smaller of its own limit and its room's seats. Enrolling locks the cohort
  row, so 50 simultaneous requests for the last seat give it to exactly one and waitlist the other 49
  (a test removes the lock to prove it would otherwise fail)
- **Waitlist:** numbered, first come first served. When someone withdraws, the longest-waiting student
  takes the seat in the same transaction, so a seat is never left empty while people wait
- **Prerequisites** must be completed first; **results** are decided by the course's completion rules
  (minimum score, minimum attendance), and a rule that needs a number that wasn't given is refused rather
  than failed. Recording a result is limited to the course's department
- Enrolling a student who came from an application finishes that application

### Importing students from a spreadsheet

- **Students > Import from CSV** (Admin, via the `students.import` permission). Download the template, fill it in
  (columns can be in any order and common alternative names like `First Name`, `Sex`, `Mobile` and `Campus` work;
  dates as `YYYY-MM-DD` or `DD/MM/YYYY`; `M`/`F` for gender), save as CSV UTF-8, then **check the file** first
- **The check is a real dry run:** it runs exactly the steps of the import and then rolls the whole transaction back, so it
  can't disagree with the real thing, saves nothing, and hands back the student numbers it used (numbers stay gapless).
  It reports counts, columns it ignored (so a typo in a heading is noticed) and every problem by line number and column,
  never repeating anyone's details
- **The import** adds the good rows and skips, and reports, rows with problems and likely duplicates (same phone or email,
  or a very similar name, against existing students and earlier rows of the same file). "Add them anyway" is an option.
  Up to 2,000 rows per file
- **Safe to retry:** it needs an `Idempotency-Key`, so a repeated request replays its first answer; and everything is
  re-checked on the server each time, so sending the same file again under a new key finds those students already there and
  skips them. Imports take one lock, so ten simultaneous imports of one file still add each person once
- Branch limits apply per row (someone limited to one branch can't add students to another), an audit entry records the
  counts without any names, and if the institution has required custom fields on students, the import says so up front
  instead of failing on every row
- Not yet: opening balances and historical payments, and custom-field columns

### Billing and payments

- **Money is whole santim**, never a float, end to end (contracts, database `bigint`, portal input parsing).
  Splitting a total across instalments always adds back to the exact total; that and every allocation rule are property-tested
- **Fees** are set per course from a date and never edited once used; a category price (e.g. scholarship)
  beats the general one, and the newest fee that had started when the class begins wins. **Payment plans** split an
  invoice by shares (in basis points) and due-date offsets
- **Invoices:** one per enrollment (a unique index, not a check), numbered from the configurable pattern, split into
  instalments. Totals are always recomputed from the instalments, so an invoice can't disagree with its parts
- **Payments** (cash, bank transfer, cheque) go through a **payment provider** interface; only the Manual provider exists,
  and an online provider later plugs in without touching allocation or receipts. A payment takes the invoice's
  row lock, pays the **oldest instalment first**, refuses an overpayment, and issues a **gapless receipt number** in
  the same transaction: 20 clerks racing for one invoice get exactly the payments that fit, numbered with no holes
- **Maker-checker approvals:** discounts and voiding a payment are requested by one person and only happen when a
  different person approves. Enforced in the service _and_ by a database check (the decider can't be the requester) and a
  trigger that freezes decided requests. A void reverses the money but keeps the receipt number used
- **Recorded money can't be rewritten behind the API's back:** the app's database role can't delete or truncate
  any money table, can't update allocations, and triggers refuse changes to an amount, number or line item
- Receipts print from the portal; PDF receipts, ID cards and certificates come with the documents branch

### Home dashboard

- The portal home shows headline numbers for the areas each person may see, from one endpoint (`GET /api/v1/dashboard`)
  that adds a block only when the caller holds the permission behind it, and limits it to the branches that permission
  reaches: **a front desk at one branch sees that branch's applications, classes, students and cash, nothing else**
- **Admin:** new applications and the pipeline, active students, open and running classes, waiting lists, seats filled per
  shift, classes starting within two weeks, enrolled students per department, money collected this month against last,
  still to collect and overdue, today's desk figures, and approvals waiting for them (never their own requests)
- **Front desk (Secretary):** the same for their branch plus today's collections, instalments due today and overdue ones,
  without revenue analytics. **Coordinator:** the academic side, no money. **Instructor** or anyone with no role: an empty
  page with a note, not an error
- Every figure is counted by the database when asked (the money uses the same code as the reports), so the home page can't
  disagree with the screens it links to. The page refreshes each minute and is never cached

### Finance reports

- **Revenue:** payments received in a date range (the month so far unless you pick one), grouped by day, month, branch,
  department, program or payment method, and filterable by any of them. Days and months are counted in the institution's
  time zone, so a payment at 00:30 local time on the 1st lands on the 1st. A payment that was later **voided** is left out of
  the totals and shown separately so the numbers can be reconciled
- **Outstanding balances:** every unpaid instalment on an invoice that isn't void, aged as of any day: not yet due,
  1-30, 31-60, 61-90 and over 90 days overdue, with the list of instalments behind each bucket
- Figures are computed by the database from the same rows the invoices use (a test checks the revenue total equals the
  sum the invoices say was paid), never from separate tallies that could drift
- **CSV export** for both reports (UTF-8 with a byte-order mark so Excel reads Amharic names; money as plain decimals;
  names that start with `=`, `+`, `-` or `@` are defused so a spreadsheet can't run them as formulas). Each export is
  written to the audit log with its filters and row count, never the rows
- Only the new `reports.finance` permission (Admin) opens them, and a grant limited to one branch or department only
  ever sees that branch's or department's money, even if the caller asks for another

### Documents, verification and reminders

- **PDFs** are rendered by Gotenberg (headless Chromium in its own container, no internet needed): an A5 or
  80 mm thermal **receipt**, a credit-card-size **student ID**, and an A4 landscape **certificate**, each with the
  institution's letterhead and colour. Templates escape every value (a student's name can't inject markup or
  make the renderer fetch a URL) and use inline SVG QR codes. A smoke test renders all five through a real
  Gotenberg and checks each is exactly one page at the right size; Amharic text uses Noto Sans Ethiopic
- **Certificates:** issued for a completed course that awards one; names are copied onto the certificate so it never
  changes, serials come from the gapless counter, and issuing twice is impossible (unique index). An optional
  policy withholds them until fees are paid in full. Revoking keeps the record; reissue = revoke, then issue again
- **Public verification:** each certificate and ID card carries a random 256-bit token in its QR code. Anyone can
  check it on the website (`/verify/<token>`, which is what the QR opens; the API answers at `/api/v1/verify/<token>`,
  no sign-in) and sees only what's printed on the document, or that it was revoked or expired.
  Reissuing an ID card revokes the old one, so a lost card stops verifying
- **Fee reminders:** an hourly worker job emails the payer (or the student) 3 days before an instalment is due, on the
  day, and 3 and 7 days after, **once per stage** (a unique key makes that hold across workers), skipping paid
  instalments and invoices made today. A missed run catches up within two days, never floods with old stages

### Public website

- **Catalog pages** built live from the catalog: only published programs and active courses show, grouped by
  department, each course with the classes still open to join, their shift (days and times), branch, start date and
  the **seats left right now**. Headcounts and waiting lists stay private. Wording follows the institution's terminology
  and colours, and the whole site answers "not available" when the website module is switched off
- **Pre-registration** (`POST /api/v1/public/pre-registrations`) turns the web form into an application in the
  admissions queue, tagged "Website", and emails the applicant a reference. It needs an `Idempotency-Key` (a UUID:
  retries replay the first answer), is rate limited per visitor, carries a hidden honeypot field, and asks for consent.
  The same person asking twice for the same course while their first request is open creates one application, even
  when ten requests arrive at once (an advisory lock on their phone number), and the reply doesn't reveal that an
  earlier request existed, so nobody can probe whose number is on file
- **Certificate and ID checks:** the page behind the QR code shows Genuine, Revoked or Expired, or "not found"
- Search engines get a sitemap, `robots.txt`, canonical links, Open Graph data and JSON-LD; verification pages are
  kept out of results. The site reads the API server-side through a small cache (so many visitors don't spend the
  API's rate limit) and keeps serving the last good answer if the API is briefly down
- In production the site and API share one domain (Caddy sends `/api` to the API); in development the site proxies
  `/api` to `API_INTERNAL_URL`

### News and announcements

- **Posts** (announcement, news or story) are plain text, written in the portal under **News**. A post's state is just its
  publish time: none is a draft, a future time is scheduled, a past one is live. So scheduling needs no background
  job, and a scheduled post appears on the website at that moment by itself
- **Who does what:** Coordinators (and Admins) write drafts; only someone with the publish permission (Admins) publishes,
  schedules, unpublishes or deletes, and only they can edit or delete a post that is live or scheduled
- On the website: a news page with filters and paging, a page per post, a "latest news" strip on the home page, an RSS
  feed (`/feed.xml`) and sitemap entries. Text is escaped everywhere, so markup typed into a post shows as text
- Post addresses are made from the title (titles with no Latin letters get a numbered fallback), stay fixed when the title
  is edited, and stay unique when several posts are created at once. Audit entries name the post's address, never its text
- Switched off with the News module: the portal screen and every public route disappear

### Authentication

- Server-side sessions in an HttpOnly `__Host-` cookie (only a SHA-256 of the token is stored), with idle and absolute timeouts
- Argon2id passwords, checked against common and personal-info patterns (zxcvbn)
- TOTP two-factor with replay protection and single-use recovery codes; secrets encrypted with AES-256-GCM
- Generic errors and constant-time checks (no account enumeration), progressive lockout, per-IP rate limits
- CSRF protection via Origin / Fetch-Metadata checks on every state-changing request
- Append-only security event log (the app's database role can't update or delete it)

### Access control

- Four built-in roles (Admin, Coordinator, Secretary, Instructor) defined in `packages/permissions`,
  synced into the database on every migrate. Roles can be granted institution-wide or per branch/department
- Every API route declares `@Public()`, `@SelfService()` or `@RequirePermission(...)`. Anything else is
  denied, and a test fails CI if a route forgets
- A permission matrix test checks every role against every protected endpoint
- Staff join by invitation (single-use link, 72 h). The last active admin can't be removed or disabled
- Hash-chained, append-only audit log of staff and role changes, with an integrity check in the portal

### Browser and network hardening

- **Content Security Policy on the website and the portal:** every page gets a fresh one-time nonce, and only scripts
  carrying it run, so an injected `<script>` is refused by the browser. No inline or eval'd scripts in production, no
  framing (`frame-ancestors 'none'`), no plugins, forms and connections only to the site itself, and https is forced.
  Also sent: `nosniff`, a strict referrer policy, a locked-down permissions policy, `Cross-Origin-Opener-Policy`, and HSTS in
  production. Pages are rendered per request so the nonce can be stamped on them. If a page ever misbehaves under the
  policy, set `CSP_REPORT_ONLY=true` to see what would be blocked in the browser console without blocking it
- **The API** sends `Cache-Control: no-store` on everything unless a route says otherwise, a locked-down CSP, HSTS, and a
  CORS list that is closed by default
- **Anonymous routes are inventoried:** a test lists every endpoint that needs no sign-in (sign-in, password reset,
  invitations, certificate check, the public catalog, news, pre-registration) with its reason, and fails if a new one
  appears without being added on purpose. Every anonymous route that takes a secret or changes something must also set its own
  rate limit, which the same test checks
- **Dependencies:** CI audits them on every change and weekly (`pnpm audit`), alongside Trivy and gitleaks; the
  known esbuild advisory from drizzle-kit's old loader is fixed with a pinned override

### Reliability

- **Idempotency keys:** side-effecting endpoints accept an `Idempotency-Key`. A retry (double-click, flaky
  network) replays the first response instead of repeating the work, even under concurrent duplicates
- **Transactional outbox:** events (like emails) are written in the same transaction as the change and
  delivered by the worker through BullMQ on Valkey. Rolled-back changes send nothing; crashes lose nothing.
  Payloads carrying links or tokens are encrypted at rest and in the queue
- **Exactly-once handlers:** an inbox table makes redelivered events run once per handler
- **Housekeeping jobs** (expired keys, delivered events, dead sessions) run on fixed schedules

### Database roles

The API never connects as a superuser. `pnpm db:bootstrap` creates three roles from the URLs in `.env`:

| Role            | Used by     | Can                                        |
| --------------- | ----------- | ------------------------------------------ |
| `emis_migrator` | migrations  | own the schema, run DDL                    |
| `emis_app`      | API, worker | read and write rows; no DDL, no `TRUNCATE` |
| `emis_readonly` | reporting   | `SELECT` only, read-only transactions      |

## Deploying

`infra/docker` holds the production stack: one compose file that runs the API, worker, website, portal, database,
queue and PDF service behind **Caddy** (automatic HTTPS, `/api` and the two sites on one origin per address). Three
images (API and worker, website, portal) are built from one Dockerfile on a Node-only base, run as a non-root user, and are
published on every merge to `main` and on version tags with build provenance, an SBOM and a keyless signature. Only
Caddy publishes ports; the API, apps, database, queue and PDF service have no route to the internet. CI builds the
images, scans them, brings the whole stack up and runs `smoke.sh` against it on every change. See
[docs/deployment.md](docs/deployment.md) for the step-by-step guide.

## Quality checks

```bash
pnpm check              # lint + typecheck + unit tests
pnpm test:integration   # against a real Postgres in Docker (Testcontainers)
pnpm deps:check   # architectural boundaries
pnpm format       # Prettier
pnpm e2e          # the whole journey in a real browser (needs `pnpm infra:up` and `pnpm db:bootstrap` first)
```

### End-to-end test

`pnpm e2e` builds everything, creates a fresh `emis_e2e` database, seeds one course with an open class and three staff
accounts, starts the API, worker, website and portal as production builds (so the real Content-Security-Policy is in force),
and drives Chromium through the story the system exists for:

1. A visitor finds a course on the website and pre-registers; the confirmation email really arrives (through the outbox,
   the worker and Mailpit)
2. The front desk signs in, finds the application, registers the student, enrols them, creates the invoice, records a
   payment and opens the receipt, whose PDF is fetched and checked
3. A coordinator records the result and issues the certificate
4. Anyone opens the certificate's QR link on the website and sees "Genuine"; an admin revokes it and the same link says
   "Revoked"

Every browser session in the test is watched: a script or style the security policy refuses, or an uncaught JavaScript
error, fails the test. A second set of tests checks what the browser does with the policy (a new nonce each load, injected
markup that would run script is refused, the pages can't be framed by another site). It runs in CI on every change, and
keeps traces and logs from a failed run. First time locally: `pnpm --filter @emis/e2e exec playwright install chromium`.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and are checked by a
git hook.
