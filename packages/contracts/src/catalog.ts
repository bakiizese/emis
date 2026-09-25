import { z } from 'zod';

import { orgCodeSchema } from './settings.js';

export const CATALOG_ERROR_CODES = {
  codeTaken: 'CODE_TAKEN',
  programNotFound: 'PROGRAM_NOT_FOUND',
  courseNotFound: 'COURSE_NOT_FOUND',
  crossProgramPrerequisite: 'CROSS_PROGRAM_PREREQUISITE',
  prerequisiteCycle: 'PREREQUISITE_CYCLE',
  holidayExists: 'HOLIDAY_EXISTS',
  invalidTimeRange: 'INVALID_TIME_RANGE',
  invalidRegistrationWindow: 'INVALID_REGISTRATION_WINDOW',
  academicYearNotFound: 'ACADEMIC_YEAR_NOT_FOUND',
  academicYearOverlap: 'ACADEMIC_YEAR_OVERLAP',
  intakeNotFound: 'INTAKE_NOT_FOUND',
  holidayNotFound: 'HOLIDAY_NOT_FOUND',
  shiftNotFound: 'SHIFT_NOT_FOUND',
  roomNotFound: 'ROOM_NOT_FOUND',
  branchNotFound: 'BRANCH_NOT_FOUND',
} as const;

const name2to120 = z.string().trim().min(2).max(120);
const description = z.string().trim().max(1000).default('');
const sortOrder = z.number().int().min(0).max(10_000).default(0);

// --- programs ----------------------------------------------------------------------------------

export const PROGRAM_TYPES = ['long_course', 'short_course', 'exam_prep'] as const;
export const programTypeSchema = z.enum(PROGRAM_TYPES);
export type ProgramType = z.infer<typeof programTypeSchema>;

export const programSchema = z.object({
  id: z.uuid(),
  departmentId: z.uuid(),
  code: z.string(),
  name: z.string(),
  type: programTypeSchema,
  description: z.string(),
  isPublished: z.boolean(),
  sortOrder: z.number().int(),
  version: z.number().int(),
});
export type Program = z.infer<typeof programSchema>;

export const createProgramRequestSchema = z.object({
  departmentId: z.uuid(),
  code: orgCodeSchema,
  name: name2to120,
  type: programTypeSchema,
  description,
  sortOrder,
});
export type CreateProgramRequest = z.input<typeof createProgramRequestSchema>;

export const updateProgramRequestSchema = z
  .object({
    name: name2to120,
    description: description.removeDefault(),
    sortOrder: sortOrder.removeDefault(),
    isPublished: z.boolean(),
  })
  .partial();
export type UpdateProgramRequest = z.input<typeof updateProgramRequestSchema>;

export const programListQuerySchema = z.object({ departmentId: z.uuid().optional() });
export type ProgramListQuery = z.infer<typeof programListQuerySchema>;

export const programListResponseSchema = z.object({ items: z.array(programSchema) });
export type ProgramListResponse = z.infer<typeof programListResponseSchema>;

// --- courses / levels ----------------------------------------------------------------------------

export const courseSchema = z.object({
  id: z.uuid(),
  programId: z.uuid(),
  code: z.string(),
  name: z.string(),
  levelOrder: z.number().int(),
  durationWeeks: z.number().int().nullable(),
  totalHours: z.number().int().nullable(),
  minAttendancePercent: z.number().int().nullable(),
  minScore: z.number().nullable(),
  certificateEligible: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  /** Course ids that must be completed first. */
  prerequisiteIds: z.array(z.uuid()),
  version: z.number().int(),
});
export type Course = z.infer<typeof courseSchema>;

const percent = z.number().int().min(0).max(100).nullable().default(null);
const score = z.number().min(0).max(100).nullable().default(null);

export const createCourseRequestSchema = z.object({
  programId: z.uuid(),
  code: orgCodeSchema,
  name: name2to120,
  levelOrder: z.number().int().min(0).max(1000).default(0),
  durationWeeks: z.number().int().min(1).max(260).nullable().default(null),
  totalHours: z.number().int().min(1).max(5000).nullable().default(null),
  minAttendancePercent: percent,
  minScore: score,
  certificateEligible: z.boolean().default(true),
  sortOrder,
});
export type CreateCourseRequest = z.input<typeof createCourseRequestSchema>;

export const updateCourseRequestSchema = z
  .object({
    name: name2to120,
    levelOrder: z.number().int().min(0).max(1000),
    durationWeeks: z.number().int().min(1).max(260).nullable(),
    totalHours: z.number().int().min(1).max(5000).nullable(),
    minAttendancePercent: percent.removeDefault(),
    minScore: score.removeDefault(),
    certificateEligible: z.boolean(),
    sortOrder: sortOrder.removeDefault(),
    isActive: z.boolean(),
  })
  .partial();
export type UpdateCourseRequest = z.input<typeof updateCourseRequestSchema>;

export const courseListQuerySchema = z.object({ programId: z.uuid() });
export type CourseListQuery = z.infer<typeof courseListQuerySchema>;

export const courseListResponseSchema = z.object({ items: z.array(courseSchema) });
export type CourseListResponse = z.infer<typeof courseListResponseSchema>;

/** Replaces the whole prerequisite list for a course. Prerequisites must be in the same program. */
export const setCoursePrerequisitesRequestSchema = z.object({
  courseIds: z.array(z.uuid()).max(20).default([]),
});
export type SetCoursePrerequisitesRequest = z.infer<typeof setCoursePrerequisitesRequestSchema>;

// --- academic calendar ---------------------------------------------------------------------------

export const academicYearSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  version: z.number().int(),
});
export type AcademicYear = z.infer<typeof academicYearSchema>;

const dateRangeFields = { startDate: z.iso.date(), endDate: z.iso.date() };
function afterStart(value: { startDate: string; endDate: string }, ctx: z.RefinementCtx) {
  if (value.endDate <= value.startDate) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Must be after the start date.' });
  }
}

export const createAcademicYearRequestSchema = z
  .object({ name: z.string().trim().min(2).max(40), ...dateRangeFields })
  .superRefine(afterStart);
export type CreateAcademicYearRequest = z.infer<typeof createAcademicYearRequestSchema>;

export const updateAcademicYearRequestSchema = z
  .object({ name: z.string().trim().min(2).max(40), ...dateRangeFields })
  .superRefine(afterStart);
export type UpdateAcademicYearRequest = z.infer<typeof updateAcademicYearRequestSchema>;

export const academicYearListResponseSchema = z.object({ items: z.array(academicYearSchema) });
export type AcademicYearListResponse = z.infer<typeof academicYearListResponseSchema>;

export const intakeSchema = z.object({
  id: z.uuid(),
  programId: z.uuid().nullable(),
  name: z.string(),
  startDate: z.iso.date(),
  registrationOpensAt: z.iso.datetime().nullable(),
  registrationClosesAt: z.iso.datetime().nullable(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type Intake = z.infer<typeof intakeSchema>;

function registrationWindowOk(
  value: { registrationOpensAt: string | null; registrationClosesAt: string | null },
  ctx: z.RefinementCtx,
) {
  if (
    value.registrationOpensAt &&
    value.registrationClosesAt &&
    value.registrationClosesAt <= value.registrationOpensAt
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['registrationClosesAt'],
      message: 'Must be after registration opens.',
    });
  }
}

export const createIntakeRequestSchema = z
  .object({
    /** null means the intake applies to any program. */
    programId: z.uuid().nullable().default(null),
    name: name2to120,
    startDate: z.iso.date(),
    registrationOpensAt: z.iso.datetime().nullable().default(null),
    registrationClosesAt: z.iso.datetime().nullable().default(null),
  })
  .superRefine(registrationWindowOk);
export type CreateIntakeRequest = z.input<typeof createIntakeRequestSchema>;

export const updateIntakeRequestSchema = z
  .object({
    name: name2to120,
    startDate: z.iso.date(),
    registrationOpensAt: z.iso.datetime().nullable(),
    registrationClosesAt: z.iso.datetime().nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .superRefine((value, ctx) => {
    if (value.registrationOpensAt !== undefined || value.registrationClosesAt !== undefined) {
      registrationWindowOk(
        {
          registrationOpensAt: value.registrationOpensAt ?? null,
          registrationClosesAt: value.registrationClosesAt ?? null,
        },
        ctx,
      );
    }
  });
export type UpdateIntakeRequest = z.input<typeof updateIntakeRequestSchema>;

export const intakeListQuerySchema = z.object({ programId: z.uuid().optional() });
export type IntakeListQuery = z.infer<typeof intakeListQuerySchema>;

export const intakeListResponseSchema = z.object({ items: z.array(intakeSchema) });
export type IntakeListResponse = z.infer<typeof intakeListResponseSchema>;

export const holidaySchema = z.object({
  id: z.uuid(),
  date: z.iso.date(),
  name: z.string(),
  isRecurringAnnually: z.boolean(),
  /** null applies to every branch. */
  branchId: z.uuid().nullable(),
  version: z.number().int(),
});
export type Holiday = z.infer<typeof holidaySchema>;

export const createHolidayRequestSchema = z.object({
  date: z.iso.date(),
  name: name2to120,
  isRecurringAnnually: z.boolean().default(false),
  branchId: z.uuid().nullable().default(null),
});
export type CreateHolidayRequest = z.input<typeof createHolidayRequestSchema>;

export const updateHolidayRequestSchema = z
  .object({
    date: z.iso.date(),
    name: name2to120,
    isRecurringAnnually: z.boolean(),
    branchId: z.uuid().nullable(),
  })
  .partial();
export type UpdateHolidayRequest = z.input<typeof updateHolidayRequestSchema>;

export const holidayListResponseSchema = z.object({ items: z.array(holidaySchema) });
export type HolidayListResponse = z.infer<typeof holidayListResponseSchema>;

// --- shifts ----------------------------------------------------------------------------------

const dayOfWeekSchema = z.number().int().min(0).max(6);
const daysOfWeekSchema = z
  .array(dayOfWeekSchema)
  .min(1)
  .max(7)
  .refine((days) => new Set(days).size === days.length, 'Days must be unique.')
  .transform((days) => [...days].sort((a, b) => a - b));

const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM, e.g. 14:30');

function endsAfterStart(value: { startTime: string; endTime: string }, ctx: z.RefinementCtx) {
  if (value.endTime <= value.startTime) {
    ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Must be after the start time.' });
  }
}

export const shiftSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  daysOfWeek: z.array(dayOfWeekSchema),
  startTime: z.string(),
  endTime: z.string(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type Shift = z.infer<typeof shiftSchema>;

export const createShiftRequestSchema = z
  .object({
    code: orgCodeSchema,
    name: name2to120,
    daysOfWeek: daysOfWeekSchema,
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema,
  })
  .superRefine(endsAfterStart);
export type CreateShiftRequest = z.input<typeof createShiftRequestSchema>;

export const updateShiftRequestSchema = z
  .object({
    name: name2to120,
    daysOfWeek: daysOfWeekSchema,
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema,
    isActive: z.boolean(),
  })
  .partial()
  .superRefine((value, ctx) => {
    const { startTime, endTime } = value;
    if (startTime !== undefined && endTime !== undefined)
      endsAfterStart({ startTime, endTime }, ctx);
  });
export type UpdateShiftRequest = z.input<typeof updateShiftRequestSchema>;

export const shiftListResponseSchema = z.object({ items: z.array(shiftSchema) });
export type ShiftListResponse = z.infer<typeof shiftListResponseSchema>;

// --- rooms / facilities --------------------------------------------------------------------------

export const ROOM_TYPES = ['classroom', 'lab', 'studio'] as const;
export const roomTypeSchema = z.enum(ROOM_TYPES);
export type RoomType = z.infer<typeof roomTypeSchema>;

export const roomSchema = z.object({
  id: z.uuid(),
  branchId: z.uuid(),
  code: z.string(),
  name: z.string(),
  type: roomTypeSchema,
  capacity: z.number().int(),
  features: z.array(z.string()),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type Room = z.infer<typeof roomSchema>;

const featuresSchema = z.array(z.string().trim().min(1).max(40)).max(10).default([]);

export const createRoomRequestSchema = z.object({
  branchId: z.uuid(),
  code: orgCodeSchema,
  name: name2to120,
  type: roomTypeSchema,
  capacity: z.number().int().min(1).max(500),
  features: featuresSchema,
});
export type CreateRoomRequest = z.input<typeof createRoomRequestSchema>;

export const updateRoomRequestSchema = z
  .object({
    name: name2to120,
    type: roomTypeSchema,
    capacity: z.number().int().min(1).max(500),
    features: featuresSchema.removeDefault(),
    isActive: z.boolean(),
  })
  .partial();
export type UpdateRoomRequest = z.input<typeof updateRoomRequestSchema>;

export const roomListQuerySchema = z.object({ branchId: z.uuid().optional() });
export type RoomListQuery = z.infer<typeof roomListQuerySchema>;

export const roomListResponseSchema = z.object({ items: z.array(roomSchema) });
export type RoomListResponse = z.infer<typeof roomListResponseSchema>;
