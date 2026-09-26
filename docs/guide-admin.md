# Administrator guide

For the person who runs the system: sets it up, manages staff, watches the money, and keeps it healthy. Installing and
backing up are in the [deployment guide](deployment.md).

## First sign-in

The first administrator is created on the server (see the deployment guide). Sign in at the portal address. Administrators
must use two-factor authentication, so you are taken through it: scan the QR code with an authenticator app (Google
Authenticator, Authy or similar), enter the code, and **save the recovery codes somewhere safe**. Each works once if you lose
your phone.

## Setting up the institution

The **setup wizard** appears the first time. Fill in the institution's name and colour, currency, time zone, fiscal year
start, the branches, and the departments (start from the Language, Computer or Tutoring packs, or add your own). It can be
changed later under **Settings**:

| Under Settings     | What it does                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **General**        | Name, contact details, colour, time zone, and the rule that certificates need fees paid in full                                                                                        |
| **Branches**       | Your campuses. Staff can be limited to one branch                                                                                                                                      |
| **Departments**    | Language, Computer... Staff can be limited to one department                                                                                                                           |
| **Modules**        | Switch features on or off: website, online pre-registration, placement, certificates, ID cards, fee reminders, news. A switched-off feature disappears from the portal and the website |
| **Dropdown lists** | The choices in dropdowns: student categories, how people heard about you, discount reasons, withdrawal reasons                                                                         |
| **Custom fields**  | Extra fields on students or applicants (a required one must be filled in, so add them carefully)                                                                                       |
| **Terminology**    | Rename things: "class" to "batch", "shift" to "session". The portal and the website follow                                                                                             |
| **Numbering**      | How student, invoice, receipt and application numbers look, for example `RCP-{BRANCH}-{FY}-{SEQ:6}`                                                                                    |

## What you teach

Under **Academics**: **Programs** (with their courses and levels, prerequisites and completion rules such as minimum attendance
and pass mark), **Academic years**, **Intakes** (registration windows), **Holidays**, **Shifts** (days and times) and **Rooms**
(with seats). Publish a program to show it on the website: unpublished programs and inactive courses are hidden from the public.

Then **Classes**: create a class (a course in a shift and room, with an instructor and dates), and **open** it to take
enrollments. The system refuses to double-book a room or an instructor, and a class holds the smaller of its size and its room's seats.

## Fees

Under **Billing > Fees and plans**: set a fee for each course (from a date; once used, a fee is never edited, so you add a new
one instead), optionally a different price for a student category (for example a scholarship), and **payment plans** that
split an invoice into instalments (for example 50%, 30%, 20%, due today, in 30 days and in 60 days).

## Staff and what they can do

Under **Staff**, press **Invite staff**, enter their email and choose a role and where it applies:

| Role            | Can do                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Admin**       | Everything, including settings, staff, approving discounts and voids, reports, publishing news, revoking certificates |
| **Coordinator** | Programs and courses, classes and scheduling, placement, results, issuing certificates, drafting news; not money      |
| **Secretary**   | Applicants and students, enrolling, invoices and payments at their branch, ID cards; can request discounts and voids  |
| **Instructor**  | Read-only for now                                                                                                     |

A role can be limited to one branch or department. The invitation link works once and expires in 72 hours. Disable a person
under **Staff** when they leave; the last active administrator can't be removed or disabled.

## Approving discounts and voids

Under **Billing > Approvals** you see requests from staff. Read the reason, then **Approve** or **Reject**. You can't decide your
own request: another administrator must, which is deliberate. Approved voids reverse the payment but keep its receipt number.

## Watching the money

**Reports** shows **Revenue** (what was collected, by day, month, branch, department, program or payment method; voided payments
are shown separately, not counted) and **Outstanding** (unpaid instalments by how overdue: not due, 1-30, 31-60, 61-90, over 90
days, with the list behind each). Both download as CSV for a spreadsheet, and every download is logged. The **home page** shows
collected this month against last, what is still to collect, and what is overdue. The system emails payers before and after
instalments are due (3 days before, on the day, 3 and 7 days after).

## Loading existing students

**Students > Import from CSV**: download the template, fill it in (or use your own spreadsheet; common column names such as First
Name, Sex, Mobile and Campus are understood), save as **CSV UTF-8**, and press **Check the file**. It shows what would happen and
every problem by line, and saves nothing. When it looks right, press **Import**. Likely duplicates are left out by default.
Sending the same file again is safe: those students are already there.

## The website

Publish courses (**Academics**), open classes to show seats, and write **News**: drafts can be written by coordinators, and you
publish now or at a set time. People who pre-register appear in **Admissions** for the front desk to follow up. Certificates and
ID cards carry a QR code that opens a public page saying whether the document is genuine, revoked or expired.

## Certificates

A coordinator issues a certificate to a student who completed a course that awards one. To cancel one, open the student and
press **Revoke** next to it with a reason: the record stays, and the public check then says "Revoked".

## Keeping an eye on things

**Audit log** records who did what and when (never people's private details), with a check that the log has not been tampered
with. Backups run every night and are copied off the server; make sure the **backup** and **offsite** parts of the system report
healthy, and rehearse a restore once (see the deployment guide). Keep your two-factor recovery codes, the backup private key and
the encryption key somewhere safe and off the server.
