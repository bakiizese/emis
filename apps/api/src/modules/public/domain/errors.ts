import { PUBLIC_ERROR_CODES } from '@emis/contracts';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const publicErrors = {
  courseNotFound: () =>
    new NotFoundException({
      code: PUBLIC_ERROR_CODES.courseNotFound,
      message: 'That course is not on our list.',
    }),
  referenceNotFound: (what: string) =>
    new UnprocessableEntityException({
      code: PUBLIC_ERROR_CODES.referenceNotFound,
      message: `That ${what} is not available. Please pick again.`,
    }),
};
