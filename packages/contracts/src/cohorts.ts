import { z } from 'zod';

export const COHORT_ERROR_CODES = {
  cohortNotFound: 'COHORT_NOT_FOUND',
  enrollmentNotFound: 'ENROLLMENT_NOT_FOUND',
  roomConflict: 'ROOM_CONFLICT',
  instructorConflict: 'INSTRUCTOR_CONFLICT',
  invalidTransition: 'INVALID_COHORT_TRANSITION',
  notEnrolling: 'COHORT_NOT_ENROLLING',
  alreadyEnrolled: 'ALREADY_ENROLLED',
  prerequisitesNotMet: 'PREREQUISITES_NOT_MET',
  hasEnrollments: 'COHORT_HAS_ENROLLMENTS',
  noSessions: 'NO_SESSIONS',
  tooManySessions: 'TOO_MANY_SESSIONS',
  invalidEnrollmentState: 'INVALID_ENROLLMENT_STATE',
  resultIncomplete: 'RESULT_INCOMPLETE',
  notAnInstructor: 'NOT_AN_INSTRUCTOR',
  referenceNotFound: 'REFERENCE_NOT_FOUND',
  scheduleLocked: 'SCHEDULE_LOCKED',
  capacityBelowEnrolled: 'CAPACITY_BELOW_ENROLLED',
  inactiveStudent: 'STUDENT_NOT_ACTIVE',
} as const;

// --- cohorts ---------------------------------------------------------------------------------

export const COHORT_STATUSES = ['planned', 'open', 'running', 'completed', 'cancelled'] as const;
export const cohortStatusSchema = z.enum(COHORT_STATUSES);
export type CohortStatus = z.infer<typeof cohortStatusSchema>;

/** planned → open (taking enrollments) → running (classes started) → completed. Cancel before it runs. */
export const COHORT_TRANSITIONS: Record<CohortStatus, readonly CohortStatus[]> = {
  planned: ['open', 'cancelled'],
  open: ['planned', 'running', 'cancelled'],
  running: ['completed'],
  completed: [],
  cancelled: [],
};

/** Cohorts that still take (or hold) students and whose room and instructor are in use. */
export const LIVE_COHORT_STATUSES = [
  'planned',
  'open',
  'running',
] as const satisfies readonly CohortStatus[];

/** Statuses in which a student can be enrolled or added to the waitlist. */
export const ENROLLING_COHORT_STATUSES = [
  'open',
  'running',
] as const satisfies readonly CohortStatus[];

export const cohortSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  courseId: z.uuid(),
  intakeId: z.uuid().nullable(),
  shiftId: z.uuid(),
  roomId: z.uuid(),
  instructorId: z.uuid().nullable(),
  branchId: z.uuid(),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  maxSize: z.number().int(),
  /** The most students it can take: the smaller of `maxSize` and the room's seats. */
  capacity: z.number().int(),
  enrolledCount: z.number().int(),
  waitlistCount: z.number().int(),
  seatsLeft: z.number().int(),
  sessionCount: z.number().int(),
  status: cohortStatusSchema,
  version: z.number().int(),
});
export type Cohort = z.infer<typeof cohortSchema>;

const nameSchema = z.string().trim().min(2).max(120);

function endsAfterStart(value: { startDate: string; endDate: string }, ctx: z.RefinementCtx) {
  if (value.endDate < value.startDate) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: "Can't be before the start date." });
  }
}

export const createCohortRequestSchema = z
  .object({
    name: nameSchema,
    courseId: z.uuid(),
    intakeId: z.uuid().nullable().default(null),
    shiftId: z.uuid(),
    roomId: z.uuid(),
    instructorId: z.uuid().nullable().default(null),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    maxSize: z.number().int().min(1).max(500),
  })
  .superRefine(endsAfterStart);
export type CreateCohortRequest = z.input<typeof createCohortRequestSchema>;
export type CreateCohortValues = z.output<typeof createCohortRequestSchema>;

export const updateCohortRequestSchema = z
  .object({
    name: nameSchema,
    intakeId: z.uuid().nullable(),
    shiftId: z.uuid(),
    roomId: z.uuid(),
    instructorId: z.uuid().nullable(),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    maxSize: z.number().int().min(1).max(500),
  })
  .partial();
export type UpdateCohortRequest = z.input<typeof updateCohortRequestSchema>;
export type UpdateCohortValues = z.output<typeof updateCohortRequestSchema>;

export const setCohortStatusRequestSchema = z.object({ status: cohortStatusSchema });
export type SetCohortStatusRequest = z.infer<typeof setCohortStatusRequestSchema>;

export const cohortListQuerySchema = z.object({
  courseId: z.uuid().optional(),
  status: cohortStatusSchema.optional(),
  branchId: z.uuid().optional(),
  /** `live` = planned, open or running. */
  stage: z.enum(['live', 'finished']).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CohortListQuery = z.infer<typeof cohortListQuerySchema>;

export const cohortListResponseSchema = z.object({
  items: z.array(cohortSchema),
  nextCursor: z.string().nullable(),
});
export type CohortListResponse = z.infer<typeof cohortListResponseSchema>;

export const classSessionSchema = z.object({
  id: z.uuid(),
  cohortId: z.uuid(),
  sessionDate: z.iso.date(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  roomId: z.uuid(),
  instructorId: z.uuid().nullable(),
});
export type ClassSession = z.infer<typeof classSessionSchema>;

export const classSessionListResponseSchema = z.object({ items: z.array(classSessionSchema) });
export type ClassSessionListResponse = z.infer<typeof classSessionListResponseSchema>;

export const instructorSchema = z.object({ id: z.uuid(), displayName: z.string() });
export const instructorListResponseSchema = z.object({ items: z.array(instructorSchema) });
export type InstructorListResponse = z.infer<typeof instructorListResponseSchema>;

// --- enrollments -----------------------------------------------------------------------------

export const ENROLLMENT_STATUSES = [
  'waitlisted',
  'active',
  'completed',
  'failed',
  'withdrawn',
] as const;
export const enrollmentStatusSchema = z.enum(ENROLLMENT_STATUSES);
export type EnrollmentStatus = z.infer<typeof enrollmentStatusSchema>;

export const enrollmentSchema = z.object({
  id: z.uuid(),
  studentId: z.uuid(),
  studentName: z.string(),
  studentNumber: z.string(),
  cohortId: z.uuid(),
  cohortName: z.string(),
  status: enrollmentStatusSchema,
  /** 1 = next in line; null unless waitlisted. */
  waitlistPosition: z.number().int().nullable(),
  enrolledAt: z.iso.datetime().nullable(),
  withdrawnAt: z.iso.datetime().nullable(),
  withdrawalReason: z.string().nullable(),
  score: z.number().nullable(),
  attendancePercent: z.number().nullable(),
  completedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  version: z.number().int(),
});
export type Enrollment = z.infer<typeof enrollmentSchema>;

export const enrollRequestSchema = z.object({ studentId: z.uuid(), cohortId: z.uuid() });
export type EnrollRequest = z.infer<typeof enrollRequestSchema>;

/** `enrolled` got a seat; `waitlisted` joined the queue because the class was full. */
export const enrollResponseSchema = z.object({
  outcome: z.enum(['enrolled', 'waitlisted']),
  enrollment: enrollmentSchema,
});
export type EnrollResponse = z.infer<typeof enrollResponseSchema>;

export const withdrawRequestSchema = z.object({
  reasonCode: z.string().trim().min(1).max(40),
});
export type WithdrawRequest = z.infer<typeof withdrawRequestSchema>;

/** What withdrawing did, including who (if anyone) took the freed seat. */
export const withdrawResponseSchema = z.object({
  enrollment: enrollmentSchema,
  promoted: enrollmentSchema.nullable(),
});
export type WithdrawResponse = z.infer<typeof withdrawResponseSchema>;

const percentage = z.number().min(0).max(100).nullable().default(null);
export const recordResultRequestSchema = z.object({
  score: percentage,
  attendancePercent: percentage,
});
export type RecordResultRequest = z.input<typeof recordResultRequestSchema>;
export type RecordResultValues = z.output<typeof recordResultRequestSchema>;

export const enrollmentListQuerySchema = z.object({
  cohortId: z.uuid().optional(),
  studentId: z.uuid().optional(),
  status: enrollmentStatusSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type EnrollmentListQuery = z.infer<typeof enrollmentListQuerySchema>;

export const enrollmentListResponseSchema = z.object({
  items: z.array(enrollmentSchema),
  nextCursor: z.string().nullable(),
});
export type EnrollmentListResponse = z.infer<typeof enrollmentListResponseSchema>;
