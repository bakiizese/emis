import { describe, expect, it } from 'vitest';

import {
  createApplicationRequestSchema,
  canTransition,
  APPLICATION_TRANSITIONS,
  MANUAL_TARGETS,
  transitionRequestSchema,
} from './admissions.js';
import {
  createStudentRequestSchema,
  setGuardiansRequestSchema,
  updateStudentRequestSchema,
} from './students.js';

const person = {
  givenName: ' Hana ',
  fatherName: 'Bekele',
  gender: 'female',
  phone: '0911 22 33 44',
  branchId: '0199a1b2-0000-7000-8000-000000000001',
};

describe('students', () => {
  it('trims names, normalizes the phone and fills defaults', () => {
    const parsed = createStudentRequestSchema.parse({ ...person, email: ' Hana@Example.com ' });
    expect(parsed).toMatchObject({
      givenName: 'Hana',
      phone: '+251911223344',
      email: 'hana@example.com',
      grandfatherName: null,
      categoryCode: null,
      guardians: [],
      confirmNotDuplicate: false,
    });
  });

  it('turns empty optional inputs into null', () => {
    const parsed = createStudentRequestSchema.parse({
      ...person,
      email: '',
      dateOfBirth: '',
      city: '',
    });
    expect(parsed).toMatchObject({ email: null, dateOfBirth: null, city: null });
  });

  it('rejects impossible birth dates', () => {
    expect(
      createStudentRequestSchema.safeParse({ ...person, dateOfBirth: '1850-01-01' }).success,
    ).toBe(false);
    expect(
      createStudentRequestSchema.safeParse({ ...person, dateOfBirth: '2999-01-01' }).success,
    ).toBe(false);
    expect(
      createStudentRequestSchema.safeParse({ ...person, dateOfBirth: '2001-05-17' }).success,
    ).toBe(true);
  });

  it('never resets a field the update did not mention', () => {
    expect(updateStudentRequestSchema.parse({ givenName: 'Hanna' })).toEqual({
      givenName: 'Hanna',
    });
    // But an explicit clear is honored.
    expect(updateStudentRequestSchema.parse({ email: '' })).toEqual({ email: null });
  });

  it('allows one primary contact and one payer', () => {
    const guardian = { name: 'Bekele Tadesse', relationship: 'Father', phone: '0911000000' };
    expect(
      setGuardiansRequestSchema.safeParse({ guardians: [{ ...guardian, isPrimary: true }] })
        .success,
    ).toBe(true);
    expect(
      setGuardiansRequestSchema.safeParse({
        guardians: [
          { ...guardian, isPrimary: true },
          { ...guardian, name: 'Almaz Worku', isPrimary: true },
        ],
      }).success,
    ).toBe(false);
    expect(
      setGuardiansRequestSchema.safeParse({
        guardians: [
          { ...guardian, isPayer: true },
          { ...guardian, name: 'Almaz Worku', isPayer: true },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('application pipeline', () => {
  it('only moves forward along the allowed steps', () => {
    expect(canTransition('submitted', 'contacted')).toBe(true);
    expect(canTransition('offered', 'confirmed')).toBe(true);
    expect(canTransition('submitted', 'confirmed')).toBe(false);
    expect(canTransition('rejected', 'contacted')).toBe(false);
    expect(canTransition('enrolled', 'withdrawn')).toBe(false);
  });

  it('has no way out of a finished application', () => {
    for (const done of ['enrolled', 'rejected', 'withdrawn', 'expired'] as const) {
      expect(APPLICATION_TRANSITIONS[done]).toEqual([]);
    }
  });

  it('keeps placed, confirmed and enrolled out of the manual transitions', () => {
    for (const target of ['placed', 'confirmed', 'enrolled']) {
      expect(MANUAL_TARGETS).not.toContain(target);
      expect(transitionRequestSchema.safeParse({ to: target }).success).toBe(false);
    }
  });

  it('takes a walk-in applicant with defaults', () => {
    const parsed = createApplicationRequestSchema.parse(person);
    expect(parsed).toMatchObject({
      source: null,
      desiredCourseId: null,
      notes: null,
      customFields: {},
    });
  });
});
