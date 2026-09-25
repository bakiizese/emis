import { STUDENT_ERROR_CODES as c } from '@emis/contracts';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const studentErrors = {
  notFound: () => new NotFoundException({ code: c.studentNotFound, message: 'Student not found.' }),
  duplicateSuspected: () =>
    new ConflictException({
      code: c.duplicateSuspected,
      message:
        'A student with the same phone, email or a very similar name already exists. Check the matches, and if this is someone new, confirm it and try again.',
    }),
  branchNotFound: () =>
    new UnprocessableEntityException({
      code: c.branchNotFound,
      message: "That branch doesn't exist.",
    }),
};
