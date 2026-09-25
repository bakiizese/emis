import { COHORT_ERROR_CODES as c, type CohortStatus } from '@emis/contracts';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const cohortErrors = {
  cohortNotFound: () =>
    new NotFoundException({ code: c.cohortNotFound, message: 'Cohort not found.' }),
  enrollmentNotFound: () =>
    new NotFoundException({ code: c.enrollmentNotFound, message: 'Enrollment not found.' }),
  roomConflict: () =>
    new ConflictException({
      code: c.roomConflict,
      message: 'That room is already in use at one of those times by another cohort.',
    }),
  instructorConflict: () =>
    new ConflictException({
      code: c.instructorConflict,
      message: 'That instructor is already teaching another cohort at one of those times.',
    }),
  invalidTransition: (from: CohortStatus, to: CohortStatus) =>
    new ConflictException({
      code: c.invalidTransition,
      message: `A cohort that is "${from}" can't become "${to}".`,
    }),
  notEnrolling: () =>
    new ConflictException({
      code: c.notEnrolling,
      message: "This cohort isn't taking enrollments. Open it first, or pick another cohort.",
    }),
  alreadyEnrolled: () =>
    new ConflictException({
      code: c.alreadyEnrolled,
      message: 'This student is already enrolled in, or waiting for, this cohort.',
    }),
  prerequisitesNotMet: () =>
    new UnprocessableEntityException({
      code: c.prerequisitesNotMet,
      message: "The student hasn't completed the courses this one requires.",
    }),
  hasEnrollments: (what: string) =>
    new ConflictException({
      code: c.hasEnrollments,
      message: `Still has students enrolled or waiting. ${what}`,
    }),
  noSessions: () =>
    new UnprocessableEntityException({
      code: c.noSessions,
      message: 'No classes fall on the shift days between those dates (after holidays).',
    }),
  tooManySessions: () =>
    new UnprocessableEntityException({
      code: c.tooManySessions,
      message: 'That date range has too many classes. Check the end date.',
    }),
  invalidEnrollmentState: (message: string) =>
    new ConflictException({ code: c.invalidEnrollmentState, message }),
  resultIncomplete: (missing: string[]) =>
    new UnprocessableEntityException({
      code: c.resultIncomplete,
      message: `This course's completion rules need: ${missing.map((m) => (m === 'score' ? 'a score' : 'an attendance percentage')).join(' and ')}.`,
    }),
  notAnInstructor: () =>
    new UnprocessableEntityException({
      code: c.notAnInstructor,
      message: "That person isn't an active instructor.",
    }),
  referenceNotFound: (what: string) =>
    new UnprocessableEntityException({
      code: c.referenceNotFound,
      message: `That ${what} doesn't exist or isn't in use.`,
    }),
  scheduleLocked: () =>
    new ConflictException({
      code: c.scheduleLocked,
      message: "The schedule can't be changed once classes have started or the cohort is finished.",
    }),
  capacityBelowEnrolled: () =>
    new ConflictException({
      code: c.capacityBelowEnrolled,
      message: 'That would leave fewer seats than students already enrolled.',
    }),
  studentNotActive: () =>
    new UnprocessableEntityException({
      code: c.inactiveStudent,
      message: "Only active students can be enrolled. Change the student's status first.",
    }),
};
