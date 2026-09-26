import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { courses } from './catalog.js';
import { enrollments } from './cohorts.js';
import { baseColumns, idColumn } from './columns.js';
import { installments } from './billing.js';
import { students } from './students.js';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * A certificate for a completed course. The holder and course names are copied here when it's
 * issued, so it reads the same forever even if a name is corrected later. The `token` is what the
 * QR code carries: long and random, so a certificate can be verified but not guessed.
 */
export const certificates = pgTable(
  'certificates',
  {
    ...baseColumns(),
    serial: text('serial').notNull(),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'restrict' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'restrict' }),
    studentName: text('student_name').notNull(),
    courseName: text('course_name').notNull(),
    completedOn: date('completed_on', { mode: 'string' }).notNull(),
    token: text('token').notNull(),
    status: text('status').notNull().default('issued'),
    issuedAt: tstz('issued_at').notNull().defaultNow(),
    revokedAt: tstz('revoked_at'),
    revokedReason: text('revoked_reason'),
  },
  (t) => [
    uniqueIndex('certificates_serial_key').on(t.serial),
    uniqueIndex('certificates_token_key').on(t.token),
    // One live certificate per enrollment; after a revocation a new one can be issued.
    uniqueIndex('certificates_one_issued_per_enrollment_key')
      .on(t.enrollmentId)
      .where(sql`${t.status} = 'issued'`),
    index('certificates_student_id_idx').on(t.studentId),
    check('certificates_status_check', sql`${t.status} in ('issued', 'revoked')`),
    check(
      'certificates_revoked_check',
      sql`(${t.status} = 'revoked') = (${t.revokedAt} is not null)`,
    ),
  ],
);

/** A student ID card. Reissuing revokes the old one, so a lost card stops verifying. */
export const studentCards = pgTable(
  'student_cards',
  {
    ...baseColumns(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    token: text('token').notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }).notNull(),
    status: text('status').notNull().default('active'),
    issuedAt: tstz('issued_at').notNull().defaultNow(),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [
    uniqueIndex('student_cards_token_key').on(t.token),
    uniqueIndex('student_cards_one_active_per_student_key')
      .on(t.studentId)
      .where(sql`${t.status} = 'active'`),
    check('student_cards_status_check', sql`${t.status} in ('active', 'revoked')`),
    check('student_cards_dates_check', sql`${t.validUntil} >= ${t.validFrom}`),
  ],
);

/**
 * Which fee reminders have gone out. The unique key is what makes "once per stage" true even with
 * several workers: only the run that inserts the row sends the email.
 */
export const reminderLog = pgTable(
  'reminder_log',
  {
    id: idColumn(),
    installmentId: uuid('installment_id')
      .notNull()
      .references(() => installments.id, { onDelete: 'restrict' }),
    stage: text('stage').notNull(),
    /** `queued` (an email was sent) or `no_contact` (nobody to send it to). */
    outcome: text('outcome').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('reminder_log_installment_stage_key').on(t.installmentId, t.stage),
    check('reminder_log_outcome_check', sql`${t.outcome} in ('queued', 'no_contact')`),
  ],
);
