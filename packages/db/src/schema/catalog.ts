import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { baseColumns } from './columns.js';
import { branches, departments } from './settings.js';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const PROGRAM_TYPE_VALUES = ['long_course', 'short_course', 'exam_prep'] as const;
export const ROOM_TYPE_VALUES = ['classroom', 'lab', 'studio'] as const;

/** What's taught under a department, e.g. "General English" or "Web Development". */
export const programs = pgTable(
  'programs',
  {
    ...baseColumns(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    description: text('description').notNull().default(''),
    isPublished: boolean('is_published').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    uniqueIndex('programs_code_key').on(t.code),
    index('programs_department_id_idx').on(t.departmentId),
    check('programs_type_check', sql`${t.type} in ('long_course', 'short_course', 'exam_prep')`),
  ],
);

/** A level or course within a program, e.g. A1, A2, IELTS. Completion rules gate the certificate. */
export const courses = pgTable(
  'courses',
  {
    ...baseColumns(),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    levelOrder: integer('level_order').notNull().default(0),
    durationWeeks: integer('duration_weeks'),
    totalHours: integer('total_hours'),
    minAttendancePercent: integer('min_attendance_percent'),
    minScore: doublePrecision('min_score'),
    certificateEligible: boolean('certificate_eligible').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    uniqueIndex('courses_program_id_code_key').on(t.programId, t.code),
    index('courses_program_id_idx').on(t.programId),
    check(
      'courses_min_attendance_percent_check',
      sql`${t.minAttendancePercent} is null or ${t.minAttendancePercent} between 0 and 100`,
    ),
    check('courses_min_score_check', sql`${t.minScore} is null or ${t.minScore} between 0 and 100`),
  ],
);

/** Course A can't be enrolled in until course B (in the same program) is complete. */
export const coursePrerequisites = pgTable(
  'course_prerequisites',
  {
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    prerequisiteCourseId: uuid('prerequisite_course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.courseId, t.prerequisiteCourseId] }),
    check('course_prerequisites_not_self_check', sql`${t.courseId} <> ${t.prerequisiteCourseId}`),
  ],
);

/** A school year, e.g. "2026". Ranges can't overlap (enforced with an EXCLUDE constraint). */
export const academicYears = pgTable(
  'academic_years',
  {
    ...baseColumns(),
    name: text('name').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
  },
  (t) => [
    uniqueIndex('academic_years_name_key').on(t.name),
    check('academic_years_date_range_check', sql`${t.startDate} < ${t.endDate}`),
  ],
);

/** A start window students can enroll into. `programId` null applies to every program. */
export const intakes = pgTable(
  'intakes',
  {
    ...baseColumns(),
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    registrationOpensAt: tstz('registration_opens_at'),
    registrationClosesAt: tstz('registration_closes_at'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    index('intakes_program_id_idx').on(t.programId),
    check(
      'intakes_registration_window_check',
      sql`${t.registrationOpensAt} is null or ${t.registrationClosesAt} is null
        or ${t.registrationOpensAt} < ${t.registrationClosesAt}`,
    ),
  ],
);

/** A day with no classes. `branchId` null applies institution-wide. */
export const holidays = pgTable(
  'holidays',
  {
    ...baseColumns(),
    date: date('date', { mode: 'string' }).notNull(),
    name: text('name').notNull(),
    isRecurringAnnually: boolean('is_recurring_annually').notNull().default(false),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
  },
  (t) => [
    unique('holidays_date_branch_key').on(t.date, t.branchId).nullsNotDistinct(),
    index('holidays_branch_id_idx').on(t.branchId),
  ],
);

/** A named time-of-day window classes run in, e.g. "Evening" Mon/Wed/Fri 17:00–19:00. */
export const shifts = pgTable(
  'shifts',
  {
    ...baseColumns(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    daysOfWeek: integer('days_of_week').array().notNull(),
    startTime: time('start_time', { precision: 0 }).notNull(),
    endTime: time('end_time', { precision: 0 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('shifts_code_key').on(t.code),
    check('shifts_time_range_check', sql`${t.startTime} < ${t.endTime}`),
  ],
);

/** A classroom or lab at a branch. Cohorts are capped at min(room capacity, cohort max). */
export const rooms = pgTable(
  'rooms',
  {
    ...baseColumns(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    capacity: integer('capacity').notNull(),
    features: text('features')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('rooms_branch_id_code_key').on(t.branchId, t.code),
    check('rooms_type_check', sql`${t.type} in ('classroom', 'lab', 'studio')`),
    check('rooms_capacity_check', sql`${t.capacity} > 0`),
  ],
);
