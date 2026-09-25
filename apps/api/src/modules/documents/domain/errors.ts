import { DOCUMENT_ERROR_CODES as c } from '@emis/contracts';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

export const documentErrors = {
  certificateNotFound: () =>
    new NotFoundException({ code: c.certificateNotFound, message: 'Certificate not found.' }),
  notEligible: (reason: string) =>
    new UnprocessableEntityException({ code: c.notEligible, message: reason }),
  alreadyIssued: () =>
    new ConflictException({
      code: c.alreadyIssued,
      message:
        'A certificate has already been issued for this enrollment. Revoke it first to issue a new one.',
    }),
  balanceOutstanding: () =>
    new ConflictException({
      code: c.balanceOutstanding,
      message:
        'This institution only issues certificates once the fees are paid in full, and a balance is still owed.',
    }),
  alreadyRevoked: () =>
    new ConflictException({
      code: c.alreadyRevoked,
      message: 'This certificate is already revoked.',
    }),
  cardNotFound: () =>
    new NotFoundException({ code: c.cardNotFound, message: 'This student has no ID card yet.' }),
  verificationNotFound: () =>
    new NotFoundException({
      code: c.verificationNotFound,
      message: "We couldn't find a document for that code.",
    }),
  pdfUnavailable: () =>
    new ServiceUnavailableException({
      code: c.pdfUnavailable,
      message: "The PDF service isn't available right now. Try again in a moment.",
    }),
};
