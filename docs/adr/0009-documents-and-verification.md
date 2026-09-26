# 0009. PDFs from HTML in a sandboxed service, and QR codes anyone can verify

Status: accepted

## Context

Receipts, student ID cards and certificates must look professional, print at exact sizes (an A5 or 80 mm receipt, a
credit-card-size ID, an A4 landscape certificate), render Amharic correctly, and resist forgery. Anyone holding a certificate
should be able to check it is genuine without an account. The content includes names typed by people, so anything that
builds a page from them is a place for markup injection.

## Decision

- **HTML to PDF with Gotenberg** (headless Chromium in its own container). Templates are ordinary HTML and CSS with a fixed
  page size and an `overflow: hidden` container so a page can never spill onto a second sheet. Fonts include Noto Sans
  Ethiopic. The service is reachable only by the API and has no route to the internet (ADR 0011).
- **Every value is escaped.** Pages are built with a `markup` tagged template that escapes each interpolation, never by
  string concatenation. Templates load nothing from outside: no external URLs, and QR codes are inline SVG. A test feeds
  hostile names through every template.
- **Snapshots.** A certificate copies the holder's and course's names when issued, so it reads the same forever even if a
  record is corrected. Serial numbers come from the gapless counters (ADR 0007), and issuing twice is impossible (unique index).
- **Verification tokens.** Each certificate and ID card carries a random 256-bit token in its QR code, pointing at the
  public website. The verify page shows only what is printed on the document (holder, course, serial, dates) and whether it
  is valid, revoked or expired, never contact details or scores. Tokens cannot be guessed and the route is rate limited.
- **Revocation.** A certificate can be revoked (the record stays, the check says "Revoked"). Issuing a replacement ID card
  revokes the old one, so a lost card stops verifying.

## Consequences

- Good: pixel-accurate output with real HTML tooling, one place to fix a font problem, and forgery is checkable by anyone.
- Good: a compromised or buggy template cannot reach the network or other records.
- Bad: rendering needs a Chromium container (a few hundred MB) and takes a moment. A test renders every document through the
  real service and checks page count and size.
- Bad: a PDF that has already been printed cannot be recalled; only its verification status changes.

## Alternatives considered

- **A PDF library that draws pages in code** (pdfkit, react-pdf). Fiddly layout work for every template, weaker font handling.
- **wkhtmltopdf.** Unmaintained, and an older rendering engine.
- **Signed PDFs.** Stronger for exchange between institutions, but few people can check one; a QR code and a web page can.
