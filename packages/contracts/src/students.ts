import { z } from 'zod';

import { emailSchema } from './auth.js';
import { phoneSchema } from './phone.js';

export const STUDENT_ERROR_CODES = {
  studentNotFound: 'STUDENT_NOT_FOUND',
  duplicateSuspected: 'DUPLICATE_STUDENT_SUSPECTED',
  invalidDescriptor: 'INVALID_LIST_VALUE',
  branchNotFound: 'BRANCH_NOT_FOUND',
  invalidCustomFields: 'INVALID_CUSTOM_FIELDS',
} as const;

const emptyToNull = <T extends z.ZodType>(schema: T) =>
  z
    .union([z.literal(''), schema])
    .transform((value) => (value === '' ? null : value))
    .nullable();

export const GENDERS = ['female', 'male'] as const;
export const genderSchema = z.enum(GENDERS);
export type Gender = z.infer<typeof genderSchema>;

export const STUDENT_STATUSES = ['active', 'on_hold', 'graduated', 'withdrawn', 'alumni'] as const;
export const studentStatusSchema = z.enum(STUDENT_STATUSES);
export type StudentStatus = z.infer<typeof studentStatusSchema>;

const nameSchema = z.string().trim().min(1).max(60);
const dateOfBirthSchema = z.iso
  .date()
  .refine(
    (d) => d >= '1900-01-01' && d <= new Date().toISOString().slice(0, 10),
    'Not a valid birth date',
  );

/**
 * The personal details shared by students and applicants. Names follow the Ethiopian pattern.
 * `personShape` has no defaults so update schemas can `.partial()` it without an omitted field
 * being reset to its default; `personFieldsSchema` adds the defaults for creates.
 */
export const personShape = {
  givenName: nameSchema,
  fatherName: nameSchema,
  grandfatherName: emptyToNull(nameSchema),
  gender: genderSchema,
  dateOfBirth: emptyToNull(dateOfBirthSchema),
  phone: phoneSchema,
  email: emptyToNull(emailSchema),
  address: emptyToNull(z.string().trim().max(300)),
  city: emptyToNull(z.string().trim().max(80)),
};

export const personFieldsSchema = z.object({
  ...personShape,
  grandfatherName: personShape.grandfatherName.default(null),
  dateOfBirth: personShape.dateOfBirth.default(null),
  email: personShape.email.default(null),
  address: personShape.address.default(null),
  city: personShape.city.default(null),
});
export type PersonFields = z.output<typeof personFieldsSchema>;

/** Values of the institution's custom fields, keyed by field key (validated server-side). */
export const customValuesSchema = z.record(z.string().max(40), z.unknown()).default({});

export const guardianSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  relationship: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  isPrimary: z.boolean(),
  isPayer: z.boolean(),
});
export type Guardian = z.infer<typeof guardianSchema>;

export const guardianInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  relationship: z.string().trim().min(2).max(40),
  phone: phoneSchema,
  email: emptyToNull(emailSchema).default(null),
  isPrimary: z.boolean().default(false),
  isPayer: z.boolean().default(false),
});
export type GuardianInput = z.input<typeof guardianInputSchema>;
/** After validation: what services receive. */
export type GuardianValues = z.output<typeof guardianInputSchema>;

export const guardiansSchema = z
  .array(guardianInputSchema)
  .max(5)
  .refine((list) => list.filter((g) => g.isPrimary).length <= 1, 'Only one primary contact.')
  .refine((list) => list.filter((g) => g.isPayer).length <= 1, 'Only one person can be the payer.');

export const setGuardiansRequestSchema = z.object({ guardians: guardiansSchema });
export type SetGuardiansRequest = z.input<typeof setGuardiansRequestSchema>;

export const studentSchema = z.object({
  id: z.uuid(),
  studentNumber: z.string(),
  givenName: z.string(),
  fatherName: z.string(),
  grandfatherName: z.string().nullable(),
  gender: genderSchema,
  dateOfBirth: z.iso.date().nullable(),
  phone: z.string(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  status: studentStatusSchema,
  branchId: z.uuid(),
  /** A code from the "student categories" list. */
  categoryCode: z.string().nullable(),
  customFields: z.record(z.string(), z.unknown()),
  guardians: z.array(guardianSchema),
  createdAt: z.iso.datetime(),
  version: z.number().int(),
});
export type Student = z.infer<typeof studentSchema>;

/** What lists and duplicate warnings show. */
export const studentSummarySchema = studentSchema.pick({
  id: true,
  studentNumber: true,
  givenName: true,
  fatherName: true,
  grandfatherName: true,
  phone: true,
  status: true,
  branchId: true,
});
export type StudentSummary = z.infer<typeof studentSummarySchema>;

export const createStudentRequestSchema = personFieldsSchema.extend({
  branchId: z.uuid(),
  categoryCode: emptyToNull(z.string().trim().max(40)).default(null),
  customFields: customValuesSchema,
  guardians: guardiansSchema.default([]),
  /** Set after the person has looked at the possible duplicates and confirmed this is someone new. */
  confirmNotDuplicate: z.boolean().default(false),
});
export type CreateStudentRequest = z.input<typeof createStudentRequestSchema>;
export type CreateStudentValues = z.output<typeof createStudentRequestSchema>;

export const updateStudentRequestSchema = z
  .object({
    ...personShape,
    categoryCode: emptyToNull(z.string().trim().max(40)),
    customFields: z.record(z.string().max(40), z.unknown()),
    status: studentStatusSchema,
  })
  .partial();
export type UpdateStudentRequest = z.input<typeof updateStudentRequestSchema>;
export type UpdateStudentValues = z.output<typeof updateStudentRequestSchema>;

export const studentListQuerySchema = z.object({
  /** Matches name, student number or phone. */
  q: z.string().trim().max(100).optional(),
  status: studentStatusSchema.optional(),
  branchId: z.uuid().optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type StudentListQuery = z.infer<typeof studentListQuerySchema>;

export const studentListResponseSchema = z.object({
  items: z.array(studentSchema),
  nextCursor: z.string().nullable(),
});
export type StudentListResponse = z.infer<typeof studentListResponseSchema>;

// --- duplicate detection -----------------------------------------------------------------------

export const DUPLICATE_REASONS = ['same_phone', 'same_email', 'similar_name'] as const;
export const duplicateReasonSchema = z.enum(DUPLICATE_REASONS);
export type DuplicateReason = z.infer<typeof duplicateReasonSchema>;

export const duplicateQuerySchema = z.object({
  givenName: z.string().trim().max(60).optional(),
  fatherName: z.string().trim().max(60).optional(),
  grandfatherName: z.string().trim().max(60).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().max(254).optional(),
});
export type DuplicateQuery = z.infer<typeof duplicateQuerySchema>;

export const duplicateCandidateSchema = z.object({
  student: studentSummarySchema,
  reasons: z.array(duplicateReasonSchema),
  /** Name similarity 0–1 (0 when only the phone or email matched). */
  similarity: z.number(),
});
export type DuplicateCandidate = z.infer<typeof duplicateCandidateSchema>;

export const duplicateListResponseSchema = z.object({ items: z.array(duplicateCandidateSchema) });
export type DuplicateListResponse = z.infer<typeof duplicateListResponseSchema>;
