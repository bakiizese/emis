import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { baseColumns, idColumn } from './columns.js';
import { courses, intakes, shifts } from './catalog.js';
import { branches } from './settings.js';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const STUDENT_STATUS_VALUES = [
  'active',
  'on_hold',
  'graduated',
  'withdrawn',
  'alumni',
] as const;

export const APPLICATION_STATUS_VALUES = [
  'submitted',
  'contacted',
  'placement_scheduled',
  'placed',
  'offered',
  'confirmed',
  'enrolled',
  'rejected',
  'withdrawn',
  'expired',
] as const;

/**
 * A person who studies (or studied) here. `searchName` is the full name in one string with a
 * trigram index, so "hana bek" finds "Hana Bekele Tadesse" and near-misses can be flagged as
 * possible duplicates.
 */
export const students = pgTable(
  'students',
  {
    ...baseColumns(),
    studentNumber: text('student_number').notNull(),
    givenName: text('given_name').notNull(),
    fatherName: text('father_name').notNull(),
    grandfatherName: text('grandfather_name'),
    searchName: text('search_name')
      .notNull()
      .generatedAlwaysAs(
        sql`lower(given_name || ' ' || father_name || ' ' || coalesce(grandfather_name, ''))`,
      ),
    gender: text('gender').notNull(),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    /** Normalized to "+<digits>" so equal numbers compare equal. */
    phone: text('phone').notNull(),
    email: text('email'),
    address: text('address'),
    city: text('city'),
    status: text('status')
      .$type<(typeof STUDENT_STATUS_VALUES)[number]>()
      .notNull()
      .default('active'),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    /** Code from the "student categories" list. */
    categoryCode: text('category_code'),
    customFields: jsonb('custom_fields')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    uniqueIndex('students_student_number_key').on(t.studentNumber),
    index('students_search_name_trgm_idx').using('gin', sql`${t.searchName} gin_trgm_ops`),
    index('students_phone_idx').on(t.phone),
    index('students_email_idx').on(sql`lower(${t.email})`),
    index('students_branch_id_idx').on(t.branchId),
    index('students_created_at_idx').on(t.createdAt.desc(), t.id.desc()),
    check('students_gender_check', sql`${t.gender} in ('female', 'male')`),
    check(
      'students_status_check',
      sql`${t.status} in ('active', 'on_hold', 'graduated', 'withdrawn', 'alumni')`,
    ),
  ],
);

/** Contact people for a student: parents, spouse, employer sponsor. Replaced as a whole list. */
export const studentGuardians = pgTable(
  'student_guardians',
  {
    id: idColumn(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    relationship: text('relationship').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    isPrimary: boolean('is_primary').notNull().default(false),
    isPayer: boolean('is_payer').notNull().default(false),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('student_guardians_student_id_idx').on(t.studentId),
    // The database backs the "one primary contact, one payer" rule the API also checks.
    uniqueIndex('student_guardians_one_primary_key')
      .on(t.studentId)
      .where(sql`${t.isPrimary}`),
    uniqueIndex('student_guardians_one_payer_key')
      .on(t.studentId)
      .where(sql`${t.isPayer}`),
  ],
);

/** Someone who has asked to study here, from first contact until they enroll (or don't). */
export const applications = pgTable(
  'applications',
  {
    ...baseColumns(),
    reference: text('reference').notNull(),
    status: text('status')
      .$type<(typeof APPLICATION_STATUS_VALUES)[number]>()
      .notNull()
      .default('submitted'),
    givenName: text('given_name').notNull(),
    fatherName: text('father_name').notNull(),
    grandfatherName: text('grandfather_name'),
    gender: text('gender').notNull(),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    phone: text('phone').notNull(),
    email: text('email'),
    address: text('address'),
    city: text('city'),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    /** Code from the "how did you hear about us" list. */
    source: text('source'),
    desiredCourseId: uuid('desired_course_id').references(() => courses.id, {
      onDelete: 'set null',
    }),
    preferredShiftId: uuid('preferred_shift_id').references(() => shifts.id, {
      onDelete: 'set null',
    }),
    preferredIntakeId: uuid('preferred_intake_id').references(() => intakes.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    customFields: jsonb('custom_fields')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    placementScore: doublePrecision('placement_score'),
    placementCourseId: uuid('placement_course_id').references(() => courses.id, {
      onDelete: 'set null',
    }),
    placementNotes: text('placement_notes'),
    placedAt: tstz('placed_at'),
    /** Set when the applicant is converted into a student. */
    studentId: uuid('student_id').references(() => students.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('applications_reference_key').on(t.reference),
    index('applications_status_idx').on(t.status),
    index('applications_branch_id_idx').on(t.branchId),
    index('applications_phone_idx').on(t.phone),
    index('applications_created_at_idx').on(t.createdAt.desc(), t.id.desc()),
    index('applications_student_id_idx').on(t.studentId),
    check(
      'applications_status_check',
      sql`${t.status} in ('submitted', 'contacted', 'placement_scheduled', 'placed', 'offered', 'confirmed', 'enrolled', 'rejected', 'withdrawn', 'expired')`,
    ),
    check('applications_gender_check', sql`${t.gender} in ('female', 'male')`),
    check(
      'applications_placement_score_check',
      sql`${t.placementScore} is null or ${t.placementScore} between 0 and 100`,
    ),
  ],
);
