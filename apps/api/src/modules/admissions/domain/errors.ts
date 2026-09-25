import { ADMISSIONS_ERROR_CODES as c, type ApplicationStatus } from '@emis/contracts';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const admissionsErrors = {
  notFound: () =>
    new NotFoundException({ code: c.applicationNotFound, message: 'Application not found.' }),
  invalidTransition: (from: ApplicationStatus, to: string) =>
    new ConflictException({
      code: c.invalidTransition,
      message: `An application that is "${from.replaceAll('_', ' ')}" can't move to "${to.replaceAll('_', ' ')}".`,
    }),
  closed: () =>
    new ConflictException({
      code: c.applicationClosed,
      message: 'This application is finished and can no longer be changed.',
    }),
  placementNotAllowed: () =>
    new ConflictException({
      code: c.placementNotAllowed,
      message: "A placement result can't be recorded at this stage of the application.",
    }),
  placementDisabled: () =>
    new UnprocessableEntityException({
      code: c.placementDisabled,
      message: 'Placement tests are switched off for this institution.',
    }),
  alreadyConverted: () =>
    new ConflictException({
      code: c.alreadyConverted,
      message: 'This applicant has already been registered as a student.',
    }),
  notReadyToConvert: () =>
    new ConflictException({
      code: c.notReadyToConvert,
      message: 'Make the applicant an offer first, then register them as a student.',
    }),
  referenceNotFound: (what: string) =>
    new UnprocessableEntityException({
      code: c.referenceNotFound,
      message: `That ${what} doesn't exist.`,
    }),
  branchNotFound: () =>
    new UnprocessableEntityException({
      code: 'BRANCH_NOT_FOUND',
      message: "That branch doesn't exist.",
    }),
};
