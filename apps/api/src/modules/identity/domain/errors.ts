import { AUTH_ERROR_CODES } from '@emis/contracts';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';

const c = AUTH_ERROR_CODES;

/** Every auth failure the API can produce, with the codes frontends switch on. */
export const authErrors = {
  // One message for unknown email, wrong password, locked and disabled accounts: no account enumeration.
  invalidCredentials: () =>
    new UnauthorizedException({
      code: c.invalidCredentials,
      message: 'Incorrect email or password.',
    }),
  unauthenticated: () =>
    new UnauthorizedException({ code: c.unauthenticated, message: 'Sign in to continue.' }),
  mfaRequired: () =>
    new ForbiddenException({
      code: c.mfaRequired,
      message: 'Enter your authentication code to continue.',
    }),
  mfaEnrollmentRequired: () =>
    new ForbiddenException({
      code: c.mfaEnrollmentRequired,
      message: 'Set up two-factor authentication to continue.',
    }),
  invalidMfaCode: () =>
    new UnauthorizedException({ code: c.invalidMfaCode, message: 'That code is not valid.' }),
  mfaAlreadyEnabled: () =>
    new ConflictException({
      code: c.mfaAlreadyEnabled,
      message: 'Two-factor authentication is already on.',
    }),
  mfaNotEnabled: () =>
    new ConflictException({
      code: c.mfaNotEnabled,
      message: 'Two-factor authentication is not set up.',
    }),
  mfaEnforced: () =>
    new ForbiddenException({
      code: c.mfaEnforced,
      message: 'Your account requires two-factor authentication.',
    }),
  weakPassword: (reason: string) =>
    new UnprocessableEntityException({ code: c.weakPassword, message: reason }),
  invalidResetToken: () =>
    new BadRequestException({
      code: c.invalidResetToken,
      message: 'This reset link is invalid or has expired. Request a new one.',
    }),
  invalidCurrentPassword: () =>
    new BadRequestException({
      code: c.invalidCurrentPassword,
      message: 'Your current password is incorrect.',
    }),
  emailTaken: () =>
    new ConflictException({ code: 'EMAIL_TAKEN', message: 'That email is already in use.' }),
};
