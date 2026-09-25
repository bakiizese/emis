import { describe, expect, it } from 'vitest';

import {
  createAcademicYearRequestSchema,
  createCourseRequestSchema,
  createHolidayRequestSchema,
  createIntakeRequestSchema,
  createProgramRequestSchema,
  createRoomRequestSchema,
  createShiftRequestSchema,
  updateCourseRequestSchema,
  updateIntakeRequestSchema,
  updateProgramRequestSchema,
  updateShiftRequestSchema,
} from './catalog.js';

describe('programs', () => {
  it('normalizes the code and applies defaults', () => {
    const parsed = createProgramRequestSchema.parse({
      departmentId: '0199a1b2-0000-7000-8000-000000000001',
      code: ' lang ',
      name: 'General English',
      type: 'long_course',
    });
    expect(parsed).toMatchObject({ code: 'LANG', description: '', sortOrder: 0 });
  });

  it('rejects an unknown type', () => {
    expect(
      createProgramRequestSchema.safeParse({
        departmentId: '0199a1b2-0000-7000-8000-000000000001',
        code: 'LANG',
        name: 'General English',
        type: 'diploma',
      }).success,
    ).toBe(false);
  });

  it('never lets code or department change through the update schema', () => {
    const parsed = updateProgramRequestSchema.parse({ name: 'New name', isPublished: true });
    expect(parsed).toEqual({ name: 'New name', isPublished: true });
    expect('code' in updateProgramRequestSchema.shape).toBe(false);
    expect('departmentId' in updateProgramRequestSchema.shape).toBe(false);
  });
});

describe('courses', () => {
  const base = { programId: '0199a1b2-0000-7000-8000-000000000001', code: 'A1', name: 'Beginner' };

  it('applies defaults and accepts null completion fields', () => {
    const parsed = createCourseRequestSchema.parse(base);
    expect(parsed).toMatchObject({
      levelOrder: 0,
      durationWeeks: null,
      minAttendancePercent: null,
      minScore: null,
      certificateEligible: true,
    });
  });

  it('bounds attendance percent and score', () => {
    expect(
      createCourseRequestSchema.safeParse({ ...base, minAttendancePercent: 101 }).success,
    ).toBe(false);
    expect(createCourseRequestSchema.safeParse({ ...base, minAttendancePercent: -1 }).success).toBe(
      false,
    );
    expect(createCourseRequestSchema.safeParse({ ...base, minScore: 100.5 }).success).toBe(false);
    expect(createCourseRequestSchema.safeParse({ ...base, minScore: 80 }).success).toBe(true);
  });

  it('lets an update clear a completion field back to null', () => {
    const parsed = updateCourseRequestSchema.parse({ minAttendancePercent: null });
    expect(parsed).toEqual({ minAttendancePercent: null });
  });
});

describe('academic years', () => {
  it('requires the end date after the start date', () => {
    const ok = createAcademicYearRequestSchema.safeParse({
      name: '2026',
      startDate: '2026-07-08',
      endDate: '2027-07-07',
    });
    expect(ok.success).toBe(true);
    const bad = createAcademicYearRequestSchema.safeParse({
      name: '2026',
      startDate: '2026-07-08',
      endDate: '2026-07-08',
    });
    expect(bad.success).toBe(false);
  });
});

describe('intakes', () => {
  it('checks the registration window both on create and update', () => {
    expect(
      createIntakeRequestSchema.safeParse({
        name: 'September intake',
        startDate: '2026-09-01',
        registrationOpensAt: '2026-08-15T00:00:00Z',
        registrationClosesAt: '2026-08-01T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      updateIntakeRequestSchema.safeParse({
        registrationOpensAt: '2026-08-15T00:00:00Z',
        registrationClosesAt: '2026-08-01T00:00:00Z',
      }).success,
    ).toBe(false);
    // Updating only one side of the window is fine.
    expect(updateIntakeRequestSchema.safeParse({ registrationOpensAt: null }).success).toBe(true);
  });

  it('lets an intake apply to any program', () => {
    const parsed = createIntakeRequestSchema.parse({ name: 'General', startDate: '2026-09-01' });
    expect(parsed.programId).toBeNull();
  });
});

describe('holidays', () => {
  it('defaults to every branch and not recurring', () => {
    const parsed = createHolidayRequestSchema.parse({ date: '2026-09-11', name: 'New Year' });
    expect(parsed).toMatchObject({ branchId: null, isRecurringAnnually: false });
  });
});

describe('shifts', () => {
  const base = {
    code: 'EVE',
    name: 'Evening',
    daysOfWeek: [1, 3, 5],
    startTime: '17:00',
    endTime: '19:00',
  };

  it('sorts and dedupes days of week', () => {
    const parsed = createShiftRequestSchema.parse({ ...base, daysOfWeek: [5, 1, 3] });
    expect(parsed.daysOfWeek).toEqual([1, 3, 5]);
    expect(createShiftRequestSchema.safeParse({ ...base, daysOfWeek: [1, 1] }).success).toBe(false);
  });

  it('validates time format and ordering', () => {
    expect(createShiftRequestSchema.safeParse({ ...base, startTime: '25:00' }).success).toBe(false);
    expect(
      createShiftRequestSchema.safeParse({ ...base, startTime: '19:00', endTime: '17:00' }).success,
    ).toBe(false);
    expect(updateShiftRequestSchema.safeParse({ startTime: '19:00' }).success).toBe(true);
    expect(
      updateShiftRequestSchema.safeParse({ startTime: '19:00', endTime: '17:00' }).success,
    ).toBe(false);
  });
});

describe('rooms', () => {
  it('bounds capacity and feature count', () => {
    const base = {
      branchId: '0199a1b2-0000-7000-8000-000000000001',
      code: 'R1',
      name: 'Room 1',
      type: 'classroom' as const,
    };
    expect(createRoomRequestSchema.safeParse({ ...base, capacity: 0 }).success).toBe(false);
    expect(createRoomRequestSchema.safeParse({ ...base, capacity: 25 }).success).toBe(true);
    expect(
      createRoomRequestSchema.safeParse({
        ...base,
        capacity: 10,
        features: Array.from({ length: 11 }, (_, i) => `f${i}`),
      }).success,
    ).toBe(false);
  });
});

describe('academic year updates', () => {
  it('also require the end date after the start date', async () => {
    const { updateAcademicYearRequestSchema } = await import('./catalog.js');
    expect(
      updateAcademicYearRequestSchema.safeParse({
        name: '2026',
        startDate: '2026-07-08',
        endDate: '2026-01-01',
      }).success,
    ).toBe(false);
  });
});
