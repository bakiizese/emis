import { z } from 'zod';

import { emailSchema } from './auth.js';
import { programTypeSchema } from './catalog.js';
import { phoneSchema } from './phone.js';
import { genderSchema } from './students.js';

export const PUBLIC_ERROR_CODES = {
  courseNotFound: 'COURSE_NOT_FOUND',
  branchNotFound: 'BRANCH_NOT_FOUND',
  referenceNotFound: 'REFERENCE_NOT_FOUND',
} as const;

// --- catalog ---------------------------------------------------------------------------------

/** A course as the public sees it: no internal flags, no prerequisites' ids. */
export const publicCourseSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  levelOrder: z.number().int(),
  durationWeeks: z.number().int().nullable(),
  totalHours: z.number().int().nullable(),
  certificateEligible: z.boolean(),
});
export type PublicCourse = z.infer<typeof publicCourseSchema>;

export const publicProgramSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  type: programTypeSchema,
  description: z.string(),
  courses: z.array(publicCourseSchema),
});
export type PublicProgram = z.infer<typeof publicProgramSchema>;

export const publicDepartmentSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  programs: z.array(publicProgramSchema),
});
export type PublicDepartment = z.infer<typeof publicDepartmentSchema>;

/** Only published programs and active courses; departments with nothing to show are left out. */
export const publicCatalogResponseSchema = z.object({
  departments: z.array(publicDepartmentSchema),
});
export type PublicCatalogResponse = z.infer<typeof publicCatalogResponseSchema>;

// --- classes (seats per shift) ---------------------------------------------------------------

export const publicShiftSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)),
  startTime: z.string(),
  endTime: z.string(),
});
export type PublicShift = z.infer<typeof publicShiftSchema>;

export const publicBranchSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
});
export type PublicBranch = z.infer<typeof publicBranchSchema>;

/**
 * A class people can still join. `seatsLeft` is the live count; the enrolled and waitlist numbers
 * stay private.
 */
export const publicClassSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  courseId: z.uuid(),
  courseName: z.string(),
  intakeId: z.uuid().nullable(),
  shift: publicShiftSchema,
  branch: publicBranchSchema,
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  seatsLeft: z.number().int(),
  isFull: z.boolean(),
});
export type PublicClass = z.infer<typeof publicClassSchema>;

export const publicCourseDetailSchema = z.object({
  course: publicCourseSchema,
  program: publicProgramSchema.omit({ courses: true }),
  department: publicDepartmentSchema.pick({ id: true, code: true, name: true }),
  classes: z.array(publicClassSchema),
});
export type PublicCourseDetail = z.infer<typeof publicCourseDetailSchema>;

export const publicClassListResponseSchema = z.object({ items: z.array(publicClassSchema) });
export type PublicClassListResponse = z.infer<typeof publicClassListResponseSchema>;

// --- contact ---------------------------------------------------------------------------------

export const publicContactSchema = z.object({
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  branches: z.array(publicBranchSchema),
});
export type PublicContact = z.infer<typeof publicContactSchema>;

// --- pre-registration ------------------------------------------------------------------------

const optionalId = z.uuid().nullable().default(null);
const name = z.string().trim().min(1).max(60);
const emptyToNull = <T extends z.ZodType>(schema: T) =>
  z
    .union([z.literal(''), schema])
    .transform((value) => (value === '' ? null : value))
    .nullable();

/**
 * What an applicant sends from the website. A trimmed-down application: no custom fields, no
 * status. A parent or guardian's details are for applicants who are minors.
 */
export const preRegistrationRequestSchema = z.object({
  givenName: name,
  fatherName: name,
  grandfatherName: emptyToNull(name).default(null),
  gender: genderSchema,
  dateOfBirth: emptyToNull(z.iso.date()).default(null),
  phone: phoneSchema,
  email: emptyToNull(emailSchema).default(null),
  city: emptyToNull(z.string().trim().max(80)).default(null),
  branchId: z.uuid(),
  desiredCourseId: z.uuid(),
  preferredShiftId: optionalId,
  preferredIntakeId: optionalId,
  guardianName: emptyToNull(z.string().trim().min(2).max(120)).default(null),
  guardianPhone: emptyToNull(phoneSchema).default(null),
  message: emptyToNull(z.string().trim().max(500)).default(null),
  /** Must be ticked: the applicant agrees to be contacted about their request. */
  consent: z.literal(true),
  /** A field real people never see; bots that fill every input give themselves away. */
  companyWebsite: z.string().max(200).default(''),
});
export type PreRegistrationRequest = z.input<typeof preRegistrationRequestSchema>;
export type PreRegistrationValues = z.output<typeof preRegistrationRequestSchema>;

/**
 * `reference` is null when we already had this person's request open: nothing new is created and
 * nothing about the earlier request is revealed to a stranger typing someone else's number.
 */
export const preRegistrationResponseSchema = z.object({
  received: z.literal(true),
  reference: z.string().nullable(),
});
export type PreRegistrationResponse = z.infer<typeof preRegistrationResponseSchema>;
