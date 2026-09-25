import { CATALOG_ERROR_CODES as c } from '@emis/contracts';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const catalogErrors = {
  codeTaken: (what: string) =>
    new ConflictException({
      code: c.codeTaken,
      message: `A ${what} with that code already exists.`,
    }),
  programNotFound: () =>
    new NotFoundException({ code: c.programNotFound, message: 'Program not found.' }),
  /** A program id inside a request body that doesn't exist (422, not 404: the URL was fine). */
  programMissing: () =>
    new UnprocessableEntityException({
      code: c.programNotFound,
      message: "That program doesn't exist.",
    }),
  courseNotFound: () =>
    new NotFoundException({ code: c.courseNotFound, message: 'Course not found.' }),
  branchNotFound: () =>
    new UnprocessableEntityException({
      code: c.branchNotFound,
      message: "That branch doesn't exist.",
    }),
  departmentNotFound: () =>
    new UnprocessableEntityException({
      code: 'DEPARTMENT_NOT_FOUND',
      message: "That department doesn't exist or is inactive.",
    }),
  crossProgramPrerequisite: () =>
    new UnprocessableEntityException({
      code: c.crossProgramPrerequisite,
      message: 'Prerequisites must be courses in the same program, and not the course itself.',
    }),
  prerequisiteCycle: () =>
    new UnprocessableEntityException({
      code: c.prerequisiteCycle,
      message: 'Those prerequisites would make courses depend on each other in a loop.',
    }),
  holidayExists: () =>
    new ConflictException({
      code: c.holidayExists,
      message: "There's already a holiday on that date.",
    }),
  invalidTimeRange: () =>
    new UnprocessableEntityException({
      code: c.invalidTimeRange,
      message: 'The end time must be after the start time.',
    }),
  invalidRegistrationWindow: () =>
    new UnprocessableEntityException({
      code: c.invalidRegistrationWindow,
      message: 'Registration must close after it opens.',
    }),
  academicYearNotFound: () =>
    new NotFoundException({ code: c.academicYearNotFound, message: 'Academic year not found.' }),
  academicYearOverlap: () =>
    new ConflictException({
      code: c.academicYearOverlap,
      message: 'That academic year overlaps another one.',
    }),
  intakeNotFound: () =>
    new NotFoundException({ code: c.intakeNotFound, message: 'Intake not found.' }),
  holidayNotFound: () =>
    new NotFoundException({ code: c.holidayNotFound, message: 'Holiday not found.' }),
  shiftNotFound: () =>
    new NotFoundException({ code: c.shiftNotFound, message: 'Shift not found.' }),
  roomNotFound: () => new NotFoundException({ code: c.roomNotFound, message: 'Room not found.' }),
};
