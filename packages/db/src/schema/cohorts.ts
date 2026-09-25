import { sql } from 'drizzle-orm';
import {
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { courses, intakes, rooms, shifts } from './catalog.js';
import { baseColumns, idColumn } from './columns.js';
import { userAccounts } from './identity.js';
import { branches } from './settings.js';
import { students } from './students.js';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const COHORT_STATUS_VALUES = [
  'planned',
  'open',
  'running',
  'completed',
  'cancelled',
] as const;
export const ENROLLMENT_STATUS_VALUES = [
  'waitlisted',
  'active',
  'completed',
  'failed',
  'withdrawn',
] as const;

/**
 * A class: one course, in one shift and room, with an instructor, over a date range. Its seats are
 * min(room seats, maxSize); enrollment locks this row to count them safely.
 */
export const cohorts = pgTable(
  'cohorts',
  {
    ...baseColumns(),
    name: text('name').notNull(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'restrict' }),
    intakeId: uuid('intake_id').references(() => intakes.id, { onDelete: 'set null' }),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id, { onDelete: 'restrict' }),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'restrict' }),
    instructorId: uuid('instructor_id').references(() => userAccounts.id, {
      onDelete: 'restrict',
    }),
    /** The room's branch, kept here so branch-scoped roles can be checked without a join. */
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    maxSize: integer('max_size').notNull(),
    status: text('status')
      .$type<(typeof COHORT_STATUS_VALUES)[number]>()
      .notNull()
      .default('planned'),
  },
  (t) => [
    index('cohorts_course_id_idx').on(t.courseId),
    index('cohorts_room_id_idx').on(t.roomId),
    index('cohorts_instructor_id_idx').on(t.instructorId),
    index('cohorts_branch_id_idx').on(t.branchId),
    index('cohorts_start_date_idx').on(t.startDate.desc(), t.id.desc()),
    check('cohorts_date_range_check', sql`${t.endDate} >= ${t.startDate}`),
    check('cohorts_max_size_check', sql`${t.maxSize} > 0`),
    check(
      'cohorts_status_check',
      sql`${t.status} in ('planned', 'open', 'running', 'completed', 'cancelled')`,
    ),
  ],
);

/**
 * One meeting of a cohort. The database itself refuses two sessions that overlap in the same room
 * or with the same instructor (EXCLUDE constraints, added in the migration), so double-booking is
 * impossible however the sessions were created.
 */
export const classSessions = pgTable(
  'class_sessions',
  {
    id: idColumn(),
    cohortId: uuid('cohort_id')
      .notNull()
      .references(() => cohorts.id, { onDelete: 'cascade' }),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'restrict' }),
    instructorId: uuid('instructor_id').references(() => userAccounts.id, {
      onDelete: 'restrict',
    }),
    sessionDate: date('session_date', { mode: 'string' }).notNull(),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('class_sessions_cohort_id_idx').on(t.cohortId, t.sessionDate),
    index('class_sessions_room_id_idx').on(t.roomId),
    check('class_sessions_time_range_check', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

/**
 * A student's place in a cohort: on the waitlist, holding a seat (`active`), or finished.
 * Seats taken = the `active` rows. A student has at most one live (waitlisted or active) row per cohort.
 */
export const enrollments = pgTable(
  'enrollments',
  {
    ...baseColumns(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    cohortId: uuid('cohort_id')
      .notNull()
      .references(() => cohorts.id, { onDelete: 'restrict' }),
    status: text('status')
      .$type<(typeof ENROLLMENT_STATUS_VALUES)[number]>()
      .notNull()
      .default('active'),
    /** When the student joined the waitlist; the queue is ordered by this. Null if enrolled directly. */
    waitlistedAt: tstz('waitlisted_at'),
    enrolledAt: tstz('enrolled_at'),
    withdrawnAt: tstz('withdrawn_at'),
    withdrawalReason: text('withdrawal_reason'),
    score: doublePrecision('score'),
    attendancePercent: doublePrecision('attendance_percent'),
    completedAt: tstz('completed_at'),
  },
  (t) => [
    uniqueIndex('enrollments_one_live_per_student_key')
      .on(t.studentId, t.cohortId)
      .where(sql`${t.status} in ('waitlisted', 'active')`),
    index('enrollments_cohort_status_idx').on(t.cohortId, t.status),
    index('enrollments_student_id_idx').on(t.studentId),
    index('enrollments_created_at_idx').on(t.createdAt.desc(), t.id.desc()),
    check(
      'enrollments_status_check',
      sql`${t.status} in ('waitlisted', 'active', 'completed', 'failed', 'withdrawn')`,
    ),
    check('enrollments_score_check', sql`${t.score} is null or ${t.score} between 0 and 100`),
    check(
      'enrollments_attendance_check',
      sql`${t.attendancePercent} is null or ${t.attendancePercent} between 0 and 100`,
    ),
  ],
);
