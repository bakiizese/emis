import { describe, expect, it } from 'vitest';

import {
  COHORT_STATUSES,
  COHORT_TRANSITIONS,
  createCohortRequestSchema,
  recordResultRequestSchema,
  updateCohortRequestSchema,
} from './cohorts.js';

const cohort = {
  name: 'English A2 evening',
  courseId: '0199a1b2-0000-7000-8000-000000000001',
  shiftId: '0199a1b2-0000-7000-8000-000000000002',
  roomId: '0199a1b2-0000-7000-8000-000000000003',
  startDate: '2026-09-14',
  endDate: '2026-12-11',
  maxSize: 20,
};

describe('cohorts', () => {
  it('fills defaults and checks the date order', () => {
    expect(createCohortRequestSchema.parse(cohort)).toMatchObject({
      intakeId: null,
      instructorId: null,
    });
    expect(createCohortRequestSchema.safeParse({ ...cohort, endDate: '2026-09-13' }).success).toBe(
      false,
    );
    expect(createCohortRequestSchema.safeParse({ ...cohort, endDate: '2026-09-14' }).success).toBe(
      true,
    );
    expect(createCohortRequestSchema.safeParse({ ...cohort, maxSize: 0 }).success).toBe(false);
  });

  it('leaves untouched fields alone on update', () => {
    expect(updateCohortRequestSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    expect(updateCohortRequestSchema.parse({ instructorId: null })).toEqual({ instructorId: null });
  });

  it('never leaves a finished cohort', () => {
    for (const status of ['completed', 'cancelled'] as const)
      expect(COHORT_TRANSITIONS[status]).toEqual([]);
    for (const status of COHORT_STATUSES) {
      for (const to of COHORT_TRANSITIONS[status]) expect(COHORT_STATUSES).toContain(to);
    }
  });

  it('takes a result with either number missing', () => {
    expect(recordResultRequestSchema.parse({})).toEqual({ score: null, attendancePercent: null });
    expect(recordResultRequestSchema.safeParse({ score: 101 }).success).toBe(false);
  });
});
