import { z } from 'zod';

import {
  customValuesSchema,
  genderSchema,
  personFieldsSchema,
  personShape,
  studentSchema,
} from './students.js';

export const ADMISSIONS_ERROR_CODES = {
  applicationNotFound: 'APPLICATION_NOT_FOUND',
  invalidTransition: 'INVALID_TRANSITION',
  placementNotAllowed: 'PLACEMENT_NOT_ALLOWED',
  alreadyConverted: 'ALREADY_CONVERTED',
  notReadyToConvert: 'NOT_READY_TO_CONVERT',
  applicationClosed: 'APPLICATION_CLOSED',
  placementDisabled: 'PLACEMENT_DISABLED',
  referenceNotFound: 'REFERENCE_NOT_FOUND',
} as const;

export const APPLICATION_STATUSES = [
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
export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

/**
 * The admissions pipeline. `placed` is reached by recording a placement result, `confirmed` by
 * converting the applicant into a student, and `enrolled` by enrolling that student in a class;
 * the other moves go through the transition endpoint.
 */
export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  submitted: ['contacted', 'placement_scheduled', 'placed', 'offered', 'rejected', 'withdrawn'],
  contacted: ['placement_scheduled', 'placed', 'offered', 'rejected', 'withdrawn'],
  placement_scheduled: ['placed', 'contacted', 'offered', 'rejected', 'withdrawn'],
  placed: ['offered', 'rejected', 'withdrawn'],
  offered: ['confirmed', 'rejected', 'withdrawn', 'expired'],
  confirmed: ['enrolled', 'withdrawn'],
  enrolled: [],
  rejected: [],
  withdrawn: [],
  expired: [],
};

/** Statuses a person may set directly through the transition endpoint. */
export const MANUAL_TARGETS = [
  'contacted',
  'placement_scheduled',
  'offered',
  'rejected',
  'withdrawn',
  'expired',
] as const satisfies readonly ApplicationStatus[];

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[from].includes(to);
}

export const OPEN_STATUSES = [
  'submitted',
  'contacted',
  'placement_scheduled',
  'placed',
  'offered',
  'confirmed',
] as const satisfies readonly ApplicationStatus[];

export const placementSchema = z.object({
  score: z.number(),
  recommendedCourseId: z.uuid(),
  notes: z.string().nullable(),
  placedAt: z.iso.datetime(),
});
export type Placement = z.infer<typeof placementSchema>;

export const applicationSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  status: applicationStatusSchema,
  givenName: z.string(),
  fatherName: z.string(),
  grandfatherName: z.string().nullable(),
  gender: genderSchema,
  dateOfBirth: z.iso.date().nullable(),
  phone: z.string(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  branchId: z.uuid(),
  /** A code from the "how did you hear about us" list. */
  source: z.string().nullable(),
  desiredCourseId: z.uuid().nullable(),
  preferredShiftId: z.uuid().nullable(),
  preferredIntakeId: z.uuid().nullable(),
  notes: z.string().nullable(),
  customFields: z.record(z.string(), z.unknown()),
  placement: placementSchema.nullable(),
  /** Set once the applicant has been converted into a student. */
  studentId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  version: z.number().int(),
});
export type Application = z.infer<typeof applicationSchema>;

const optionalId = z.uuid().nullable().default(null);
const notes = z
  .union([z.literal(''), z.string().trim().max(1000)])
  .transform((v) => (v === '' ? null : v))
  .nullable();

export const createApplicationRequestSchema = personFieldsSchema.extend({
  branchId: z.uuid(),
  source: z.string().trim().max(40).nullable().default(null),
  desiredCourseId: optionalId,
  preferredShiftId: optionalId,
  preferredIntakeId: optionalId,
  notes: notes.default(null),
  customFields: customValuesSchema,
});
export type CreateApplicationRequest = z.input<typeof createApplicationRequestSchema>;
export type CreateApplicationValues = z.output<typeof createApplicationRequestSchema>;

export const updateApplicationRequestSchema = z
  .object({
    ...personShape,
    source: z.string().trim().max(40).nullable(),
    desiredCourseId: z.uuid().nullable(),
    preferredShiftId: z.uuid().nullable(),
    preferredIntakeId: z.uuid().nullable(),
    notes,
    customFields: z.record(z.string().max(40), z.unknown()),
  })
  .partial();
export type UpdateApplicationRequest = z.input<typeof updateApplicationRequestSchema>;
export type UpdateApplicationValues = z.output<typeof updateApplicationRequestSchema>;

export const applicationListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: applicationStatusSchema.optional(),
  /** `open` = anything still in the pipeline. */
  stage: z.enum(['open', 'closed']).optional(),
  branchId: z.uuid().optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ApplicationListQuery = z.infer<typeof applicationListQuerySchema>;

export const applicationListResponseSchema = z.object({
  items: z.array(applicationSchema),
  nextCursor: z.string().nullable(),
});
export type ApplicationListResponse = z.infer<typeof applicationListResponseSchema>;

export const transitionRequestSchema = z.object({
  to: z.enum(MANUAL_TARGETS),
  note: z.string().trim().max(500).optional(),
});
export type TransitionRequest = z.infer<typeof transitionRequestSchema>;

export const placementRequestSchema = z.object({
  score: z.number().min(0).max(100),
  recommendedCourseId: z.uuid(),
  notes: notes.default(null),
});
export type PlacementRequest = z.input<typeof placementRequestSchema>;
export type PlacementValues = z.output<typeof placementRequestSchema>;

export const convertRequestSchema = z.object({
  /** Link to a student who already exists instead of creating a new one. */
  existingStudentId: z.uuid().nullable().default(null),
  /** After reviewing possible duplicates: this really is a new person. */
  confirmNotDuplicate: z.boolean().default(false),
  categoryCode: z.string().trim().max(40).nullable().default(null),
  /** Values for the institution's student custom fields (required ones must be filled in). */
  customFields: customValuesSchema,
});
export type ConvertRequest = z.input<typeof convertRequestSchema>;
export type ConvertValues = z.output<typeof convertRequestSchema>;

export const convertResponseSchema = z.object({
  application: applicationSchema,
  student: studentSchema,
});
export type ConvertResponse = z.infer<typeof convertResponseSchema>;
