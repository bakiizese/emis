import type { PublicClass } from '@emis/contracts';
import { describe, expect, it } from 'vitest';

import { intakeFor, validatePreRegistration } from './pre-registration';

const id = (n: number) => `01a0dc31-c1b8-7412-af4c-${String(n).padStart(12, '0')}`;

const valid = {
  givenName: 'Abebe',
  fatherName: 'Kebede',
  gender: 'male',
  phone: '0911 22 33 44',
  branchId: id(1),
  desiredCourseId: id(2),
  consent: true,
};

describe('validatePreRegistration', () => {
  it('accepts a complete form', () => expect(validatePreRegistration(valid)).toBeNull());

  it('speaks to the applicant, not the developer', () => {
    const errors = validatePreRegistration({
      ...valid,
      givenName: '',
      gender: '',
      desiredCourseId: '',
      branchId: '',
    });
    expect(errors).toEqual({
      givenName: 'Enter your first name.',
      gender: 'Choose one.',
      desiredCourseId: 'Choose a course.',
      branchId: 'Choose a branch.',
    });
  });

  it('asks for consent', () => {
    expect(validatePreRegistration({ ...valid, consent: false })).toEqual({
      consent: 'Please tick this box to continue.',
    });
  });

  it('rejects a phone number that cannot be one', () => {
    expect(validatePreRegistration({ ...valid, phone: 'call me' })?.phone).toContain('valid phone');
  });

  it('treats blank optional fields as not given', () => {
    expect(
      validatePreRegistration({
        ...valid,
        email: '',
        dateOfBirth: '',
        guardianName: '',
        guardianPhone: '',
      }),
    ).toBeNull();
  });

  it('flags a bad email', () =>
    expect(validatePreRegistration({ ...valid, email: 'nope' })?.email).toBe(
      'Enter a valid email address.',
    ));
});

describe('intakeFor', () => {
  const cls = (
    n: number,
    courseId: string,
    shiftId: string,
    branchId: string,
    intakeId: string | null,
  ) =>
    ({
      id: id(n),
      courseId,
      intakeId,
      shift: { id: shiftId },
      branch: { id: branchId },
    }) as unknown as PublicClass;
  const classes = [
    cls(10, 'c1', 's1', 'b1', 'i1'),
    cls(11, 'c1', 's2', 'b1', 'i2'),
    cls(12, 'c2', 's1', 'b1', 'i3'),
  ];

  it('follows the chosen shift', () =>
    expect(intakeFor(classes, { courseId: 'c1', shiftId: 's2', branchId: '' })).toBe('i2'));
  it('takes any class of the course when no shift is picked', () =>
    expect(intakeFor(classes, { courseId: 'c1', shiftId: '', branchId: 'b1' })).toBe('i1'));
  it('gives nothing when no class matches', () =>
    expect(intakeFor(classes, { courseId: 'c9', shiftId: '', branchId: '' })).toBeNull());
});
