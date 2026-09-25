import { z } from 'zod';

import { emailSchema } from './auth.js';
import { numberPatternSchema } from './numbering.js';

export const SETTINGS_ERROR_CODES = {
  codeTaken: 'CODE_TAKEN',
  branchNotFound: 'BRANCH_NOT_FOUND',
  departmentNotFound: 'DEPARTMENT_NOT_FOUND',
  descriptorNotFound: 'DESCRIPTOR_NOT_FOUND',
  customFieldNotFound: 'CUSTOM_FIELD_NOT_FOUND',
  unknownModule: 'UNKNOWN_MODULE',
  moduleDependency: 'MODULE_DEPENDENCY',
  moduleDisabled: 'MODULE_DISABLED',
  unknownSeries: 'UNKNOWN_NUMBER_SERIES',
  lastActiveBranch: 'LAST_ACTIVE_BRANCH',
  setupCompleted: 'SETUP_ALREADY_COMPLETED',
  unknownPreset: 'UNKNOWN_PRESET',
} as const;

// --- shared field rules ----------------------------------------------------------------------

/** Short code used in numbers and lists (e.g. BOLE, LANG). Stored upper-case, fixed once created. */
export const orgCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z0-9]{2,10}$/, '2–10 letters or digits'));

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'A colour like #1d4ed8')
  .transform((v) => v.toLowerCase());

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z.string().trim().max(64).refine(isTimeZone, 'Unknown time zone');

/** Month and day the fiscal year starts, e.g. 07-08 (8 July, Ethiopian Hamle 1). */
export const monthDaySchema = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Use MM-DD, e.g. 07-08');

export const LOCALES = ['en', 'am'] as const;
export const CALENDAR_DISPLAYS = ['gregorian', 'ethiopian', 'both'] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

// --- institution -----------------------------------------------------------------------------

export const institutionSchema = z.object({
  name: z.string(),
  shortName: z.string(),
  tagline: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string(),
  primaryColor: z.string(),
  locale: z.enum(LOCALES),
  currency: z.string(),
  timezone: z.string(),
  calendarDisplay: z.enum(CALENDAR_DISPLAYS),
  fiscalYearStart: z.string(),
  /** Certificates are only issued to students with nothing left to pay. */
  certificateRequiresPaidInFull: z.boolean(),
  setupCompleted: z.boolean(),
  version: z.number().int(),
});
export type Institution = z.infer<typeof institutionSchema>;

const institutionFields = {
  name: z.string().trim().min(2).max(120),
  shortName: z.string().trim().min(2).max(30),
  tagline: optionalText(160),
  email: z
    .union([emailSchema, z.literal('')])
    .transform((v) => (v === '' ? null : v))
    .nullable(),
  phone: optionalText(30),
  website: z
    .union([z.url({ protocol: /^https?$/ }).max(200), z.literal('')])
    .transform((v) => (v === '' ? null : v))
    .nullable(),
  address: optionalText(300),
  city: optionalText(80),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.string().regex(/^[A-Z]{2}$/, 'Two-letter country code')),
  primaryColor: hexColorSchema,
  locale: z.enum(LOCALES),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.string().regex(/^[A-Z]{3}$/, 'Three-letter currency code')),
  timezone: timeZoneSchema,
  calendarDisplay: z.enum(CALENDAR_DISPLAYS),
  fiscalYearStart: monthDaySchema,
  certificateRequiresPaidInFull: z.boolean(),
};

export const updateInstitutionRequestSchema = z.object(institutionFields).partial();
export type UpdateInstitutionRequest = z.input<typeof updateInstitutionRequestSchema>;

// --- branches & departments ------------------------------------------------------------------

export const branchSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type Branch = z.infer<typeof branchSchema>;

export const createBranchRequestSchema = z.object({
  code: orgCodeSchema,
  name: z.string().trim().min(2).max(120),
  address: optionalText(300).default(null),
  phone: optionalText(30).default(null),
});
export type CreateBranchRequest = z.input<typeof createBranchRequestSchema>;

export const updateBranchRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    address: optionalText(300),
    phone: optionalText(30),
    isActive: z.boolean(),
  })
  .partial();
export type UpdateBranchRequest = z.input<typeof updateBranchRequestSchema>;

export const branchListResponseSchema = z.object({ items: z.array(branchSchema) });
export type BranchListResponse = z.infer<typeof branchListResponseSchema>;

export const departmentSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  version: z.number().int(),
});
export type Department = z.infer<typeof departmentSchema>;

export const createDepartmentRequestSchema = z.object({
  code: orgCodeSchema,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).default(''),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export type CreateDepartmentRequest = z.input<typeof createDepartmentRequestSchema>;

export const updateDepartmentRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500),
    sortOrder: z.number().int().min(0).max(10_000),
    isActive: z.boolean(),
  })
  .partial();
export type UpdateDepartmentRequest = z.input<typeof updateDepartmentRequestSchema>;

export const departmentListResponseSchema = z.object({ items: z.array(departmentSchema) });
export type DepartmentListResponse = z.infer<typeof departmentListResponseSchema>;

// --- modules ---------------------------------------------------------------------------------

/**
 * Features an institution can switch off. Code checks them with @RequiresModule(); the portal and
 * website hide what's off. Everything starts enabled.
 */
export const MODULES = {
  website: {
    name: 'Public website',
    description: 'Course catalog, news and certificate verification pages.',
    requires: [],
  },
  pre_registration: {
    name: 'Online pre-registration',
    description: 'Applicants register on the website and land in the admissions queue.',
    requires: ['website'],
  },
  placement: {
    name: 'Placement tests',
    description: 'Record placement scores and recommend a level before enrolling.',
    requires: [],
  },
  certificates: {
    name: 'Certificates',
    description: 'Issue certificates with a QR code anyone can verify.',
    requires: [],
  },
  student_ids: {
    name: 'Student ID cards',
    description: 'Print branded student ID cards.',
    requires: [],
  },
  fee_reminders: {
    name: 'Fee reminders',
    description: 'Email students before and after an installment is due.',
    requires: [],
  },
  news: {
    name: 'News and announcements',
    description: 'Publish posts on the website and the portal.',
    requires: [],
  },
} as const satisfies Record<string, { name: string; description: string; requires: string[] }>;

export type ModuleKey = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];
export const moduleKeySchema = z.enum(MODULE_KEYS as [ModuleKey, ...ModuleKey[]]);

export function isModuleKey(value: string): value is ModuleKey {
  return Object.hasOwn(MODULES, value);
}

export const moduleStateSchema = z.object({
  key: moduleKeySchema,
  name: z.string(),
  description: z.string(),
  requires: z.array(moduleKeySchema),
  enabled: z.boolean(),
});
export type ModuleState = z.infer<typeof moduleStateSchema>;

export const moduleListResponseSchema = z.object({ items: z.array(moduleStateSchema) });
export type ModuleListResponse = z.infer<typeof moduleListResponseSchema>;

export const setModuleRequestSchema = z.object({ enabled: z.boolean() });
export type SetModuleRequest = z.infer<typeof setModuleRequestSchema>;

// --- descriptors (institution-defined dropdown lists) ----------------------------------------

export const DESCRIPTOR_NAMESPACES = {
  student_category: {
    name: 'Student categories',
    description: 'Groups students for fees and reporting.',
    defaults: [
      ['regular', 'Regular'],
      ['corporate', 'Corporate'],
      ['scholarship', 'Scholarship'],
    ],
  },
  lead_source: {
    name: 'How applicants heard about us',
    description: 'Asked at registration; shows which channels bring students.',
    defaults: [
      ['walk_in', 'Walk-in'],
      ['website', 'Website'],
      ['referral', 'Friend or family'],
      ['social_media', 'Social media'],
      ['phone', 'Phone call'],
    ],
  },
  discount_reason: {
    name: 'Discount reasons',
    description: 'Required when a discount is requested.',
    defaults: [
      ['sibling', 'Sibling'],
      ['staff', 'Staff family'],
      ['early_payment', 'Early payment'],
      ['promotion', 'Promotion'],
    ],
  },
  withdrawal_reason: {
    name: 'Withdrawal reasons',
    description: 'Recorded when a student leaves a class early.',
    defaults: [
      ['schedule_conflict', 'Schedule conflict'],
      ['financial', 'Financial'],
      ['relocation', 'Moved away'],
      ['other', 'Other'],
    ],
  },
} as const satisfies Record<
  string,
  { name: string; description: string; defaults: readonly (readonly [string, string])[] }
>;

export type DescriptorNamespace = keyof typeof DESCRIPTOR_NAMESPACES;
export const DESCRIPTOR_NAMESPACE_KEYS = Object.keys(
  DESCRIPTOR_NAMESPACES,
) as DescriptorNamespace[];
export const descriptorNamespaceSchema = z.enum(
  DESCRIPTOR_NAMESPACE_KEYS as [DescriptorNamespace, ...DescriptorNamespace[]],
);

export const descriptorSchema = z.object({
  id: z.uuid(),
  namespace: descriptorNamespaceSchema,
  code: z.string(),
  label: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type Descriptor = z.infer<typeof descriptorSchema>;

export const descriptorCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Lowercase letters, digits and underscores'));

export const createDescriptorRequestSchema = z.object({
  namespace: descriptorNamespaceSchema,
  code: descriptorCodeSchema,
  label: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export type CreateDescriptorRequest = z.input<typeof createDescriptorRequestSchema>;

export const updateDescriptorRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    sortOrder: z.number().int().min(0).max(10_000),
    isActive: z.boolean(),
  })
  .partial();
export type UpdateDescriptorRequest = z.infer<typeof updateDescriptorRequestSchema>;

export const descriptorListQuerySchema = z.object({ namespace: descriptorNamespaceSchema });
export const descriptorListResponseSchema = z.object({ items: z.array(descriptorSchema) });
export type DescriptorListResponse = z.infer<typeof descriptorListResponseSchema>;

// --- terminology -----------------------------------------------------------------------------

/** Words an institution can rename, e.g. Cohort → Batch, Shift → Session. */
export const TERMS = {
  branch: ['Branch', 'Branches'],
  department: ['Department', 'Departments'],
  program: ['Program', 'Programs'],
  course: ['Course', 'Courses'],
  cohort: ['Cohort', 'Cohorts'],
  shift: ['Shift', 'Shifts'],
  intake: ['Intake', 'Intakes'],
  student: ['Student', 'Students'],
  instructor: ['Instructor', 'Instructors'],
  guardian: ['Guardian', 'Guardians'],
} as const satisfies Record<string, readonly [string, string]>;

export type TermKey = keyof typeof TERMS;
export const TERM_KEYS = Object.keys(TERMS) as TermKey[];
export const termKeySchema = z.enum(TERM_KEYS as [TermKey, ...TermKey[]]);

const wordSchema = z.string().trim().min(2).max(40);
export const termLabelsSchema = z.object({ singular: wordSchema, plural: wordSchema });
export type TermLabels = z.infer<typeof termLabelsSchema>;

export const terminologySchema = z.record(termKeySchema, termLabelsSchema);
export type Terminology = Record<TermKey, TermLabels>;

export const terminologyResponseSchema = z.object({
  items: z.array(
    z.object({
      key: termKeySchema,
      singular: z.string(),
      plural: z.string(),
      defaultSingular: z.string(),
      defaultPlural: z.string(),
    }),
  ),
});
export type TerminologyResponse = z.infer<typeof terminologyResponseSchema>;

/** The full set of overrides; terms left out go back to their default. */
export const setTerminologyRequestSchema = z.object({
  overrides: z.partialRecord(termKeySchema, termLabelsSchema),
});
export type SetTerminologyRequest = z.infer<typeof setTerminologyRequestSchema>;

export function defaultTerminology(): Terminology {
  return Object.fromEntries(
    TERM_KEYS.map((key) => [key, { singular: TERMS[key][0], plural: TERMS[key][1] }]),
  ) as Terminology;
}

// --- number series ---------------------------------------------------------------------------

export const NUMBER_SERIES = {
  student: { name: 'Student numbers', defaultPattern: 'STU-{YYYY}-{SEQ:5}' },
  application: { name: 'Application references', defaultPattern: 'APP-{YY}{MM}-{SEQ:4}' },
  invoice: { name: 'Invoices', defaultPattern: 'INV-{FY}-{SEQ:6}' },
  receipt: { name: 'Receipts', defaultPattern: 'RCP-{BRANCH}-{FY}-{SEQ:6}' },
  certificate: { name: 'Certificates', defaultPattern: 'CERT-{YYYY}-{SEQ:5}' },
} as const satisfies Record<string, { name: string; defaultPattern: string }>;

export type NumberSeriesKey = keyof typeof NUMBER_SERIES;
export const NUMBER_SERIES_KEYS = Object.keys(NUMBER_SERIES) as NumberSeriesKey[];
export const numberSeriesKeySchema = z.enum(
  NUMBER_SERIES_KEYS as [NumberSeriesKey, ...NumberSeriesKey[]],
);

export function isNumberSeriesKey(value: string): value is NumberSeriesKey {
  return Object.hasOwn(NUMBER_SERIES, value);
}

export const numberSeriesSchema = z.object({
  key: numberSeriesKeySchema,
  name: z.string(),
  pattern: z.string(),
  defaultPattern: z.string(),
  /** What the next number would look like today (at the first branch, for per-branch series). */
  example: z.string(),
});
export type NumberSeries = z.infer<typeof numberSeriesSchema>;

export const numberSeriesListResponseSchema = z.object({ items: z.array(numberSeriesSchema) });
export type NumberSeriesListResponse = z.infer<typeof numberSeriesListResponseSchema>;

export const setNumberSeriesRequestSchema = z.object({ pattern: numberPatternSchema });
export type SetNumberSeriesRequest = z.infer<typeof setNumberSeriesRequestSchema>;

// --- first-run setup -------------------------------------------------------------------------

export const setupPresetSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  departments: z.array(z.object({ code: z.string(), name: z.string(), description: z.string() })),
});
export type SetupPreset = z.infer<typeof setupPresetSchema>;

export const setupStatusResponseSchema = z.object({
  completed: z.boolean(),
  presets: z.array(setupPresetSchema),
});
export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>;

export const completeSetupRequestSchema = z.object({
  institution: z.object(institutionFields).extend({
    tagline: institutionFields.tagline.default(null),
    email: institutionFields.email.default(null),
    phone: institutionFields.phone.default(null),
    website: institutionFields.website.default(null),
    address: institutionFields.address.default(null),
    city: institutionFields.city.default(null),
    certificateRequiresPaidInFull: institutionFields.certificateRequiresPaidInFull.default(false),
  }),
  branches: z.array(createBranchRequestSchema).min(1).max(50),
  /** Department packs to start from, e.g. ["language", "computer"]. */
  presets: z.array(z.string().max(40)).max(10).default([]),
  /** Extra departments on top of the presets. */
  departments: z.array(createDepartmentRequestSchema).max(50).default([]),
  /** Fill the dropdown lists (student categories, lead sources…) with sensible defaults. */
  seedDefaultLists: z.boolean().default(true),
});
export type CompleteSetupRequest = z.input<typeof completeSetupRequestSchema>;

// --- public profile --------------------------------------------------------------------------

/** What anyone may know about the institution: login page, website header, portal chrome. */
export const publicProfileSchema = z.object({
  name: z.string(),
  shortName: z.string(),
  tagline: z.string().nullable(),
  primaryColor: z.string(),
  locale: z.enum(LOCALES),
  currency: z.string(),
  timezone: z.string(),
  calendarDisplay: z.enum(CALENDAR_DISPLAYS),
  setupCompleted: z.boolean(),
  terminology: terminologySchema,
  modules: z.record(moduleKeySchema, z.boolean()),
});
export type PublicProfile = z.infer<typeof publicProfileSchema>;
