import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { baseColumns } from './columns.js';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * The institution this install belongs to (single-tenant: exactly one row, created by the
 * migration and filled in by the setup wizard).
 */
export const institution = pgTable(
  'institution',
  {
    ...baseColumns(),
    singleton: boolean('singleton').notNull().default(true),
    name: text('name').notNull(),
    shortName: text('short_name').notNull(),
    tagline: text('tagline'),
    email: text('email'),
    phone: text('phone'),
    website: text('website'),
    address: text('address'),
    city: text('city'),
    country: text('country').notNull().default('ET'),
    primaryColor: text('primary_color').notNull().default('#1d4ed8'),
    locale: text('locale').$type<'en' | 'am'>().notNull().default('en'),
    currency: text('currency').notNull().default('ETB'),
    timezone: text('timezone').notNull().default('Africa/Addis_Ababa'),
    calendarDisplay: text('calendar_display')
      .$type<'gregorian' | 'ethiopian' | 'both'>()
      .notNull()
      .default('gregorian'),
    /** MM-DD; Ethiopia's fiscal year starts on Hamle 1 (8 July). */
    fiscalYearStart: text('fiscal_year_start').notNull().default('07-08'),
    setupCompletedAt: tstz('setup_completed_at'),
  },
  (t) => [
    uniqueIndex('institution_singleton_key').on(t.singleton),
    check('institution_singleton_check', sql`${t.singleton}`),
    check('institution_locale_check', sql`${t.locale} in ('en', 'am')`),
    check(
      'institution_calendar_display_check',
      sql`${t.calendarDisplay} in ('gregorian', 'ethiopian', 'both')`,
    ),
  ],
);

/** A campus or site. Secretaries are usually scoped to one. */
export const branches = pgTable(
  'branches',
  {
    ...baseColumns(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    phone: text('phone'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('branches_code_key').on(t.code),
    check('branches_code_check', sql`${t.code} ~ '^[A-Z0-9]{2,10}$'`),
  ],
);

/** What the institution teaches: Language, Computer, Music… Coordinators are scoped to these. */
export const departments = pgTable(
  'departments',
  {
    ...baseColumns(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    uniqueIndex('departments_code_key').on(t.code),
    check('departments_code_check', sql`${t.code} ~ '^[A-Z0-9]{2,10}$'`),
  ],
);

/** Module switches. A module without a row is on (see MODULES in @emis/contracts). */
export const moduleSettings = pgTable('module_settings', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});

/** Institution-defined dropdown values (student categories, lead sources…), grouped by namespace. */
export const descriptors = pgTable(
  'descriptors',
  {
    ...baseColumns(),
    namespace: text('namespace').notNull(),
    code: text('code').notNull(),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [uniqueIndex('descriptors_namespace_code_key').on(t.namespace, t.code)],
);

/** Extra fields an institution adds to students, applications, staff or cohorts. */
export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    ...baseColumns(),
    entityType: text('entity_type').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    fieldType: text('field_type').notNull(),
    options: text('options')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    required: boolean('required').notNull().default(false),
    helpText: text('help_text').notNull().default(''),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    uniqueIndex('custom_field_definitions_entity_key_key').on(t.entityType, t.key),
    check(
      'custom_field_definitions_entity_type_check',
      sql`${t.entityType} in ('student', 'application', 'staff', 'cohort')`,
    ),
    check(
      'custom_field_definitions_field_type_check',
      sql`${t.fieldType} in ('text', 'long_text', 'number', 'date', 'select', 'checkbox')`,
    ),
  ],
);

/** Renamed words (Cohort → Batch). A term without a row uses its default. */
export const terminologyOverrides = pgTable('terminology_overrides', {
  key: text('key').primaryKey(),
  singular: text('singular').notNull(),
  plural: text('plural').notNull(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});

/** Custom numbering patterns. A series without a row uses its default pattern. */
export const numberSeries = pgTable('number_series', {
  key: text('key').primaryKey(),
  pattern: text('pattern').notNull(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});

/**
 * Gapless counters, one per series and rendered scope (e.g. receipt / "RCP-BOLE-2026-{SEQ}").
 * Incremented with an upsert inside the caller's transaction: the row lock serializes concurrent
 * issuers, and a rollback gives the number back.
 */
export const numberCounters = pgTable(
  'number_counters',
  {
    seriesKey: text('series_key').notNull(),
    scope: text('scope').notNull(),
    lastValue: bigint('last_value', { mode: 'number' }).notNull(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.seriesKey, t.scope] }),
    check('number_counters_last_value_check', sql`${t.lastValue} > 0`),
  ],
);
