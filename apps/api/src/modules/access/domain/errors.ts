import { ACCESS_ERROR_CODES as c } from '@emis/contracts';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export const accessErrors = {
  permissionDenied: () =>
    new ForbiddenException({
      code: c.permissionDenied,
      message: "You don't have permission to do that.",
    }),
  roleNotFound: () =>
    new UnprocessableEntityException({
      code: c.roleNotFound,
      message: 'That role does not exist.',
    }),
  scopeNotAllowed: (role: string) =>
    new UnprocessableEntityException({
      code: c.scopeNotAllowed,
      message: `The ${role} role can't be limited to that scope.`,
    }),
  scopeNotAvailable: () =>
    new UnprocessableEntityException({
      code: c.scopeNotAvailable,
      message: "That branch or department doesn't exist.",
    }),
  lastAdmin: () =>
    new ConflictException({
      code: c.lastAdmin,
      message: 'At least one active admin must remain. Add another admin first.',
    }),
  cannotChangeSelf: () =>
    new ConflictException({
      code: c.cannotChangeSelf,
      message: "You can't disable your own account.",
    }),
  userNotFound: () =>
    new NotFoundException({ code: c.userNotFound, message: 'Staff member not found.' }),
  assignmentNotFound: () =>
    new NotFoundException({
      code: 'ROLE_ASSIGNMENT_NOT_FOUND',
      message: 'Role assignment not found.',
    }),
  roleAlreadyAssigned: () =>
    new ConflictException({
      code: c.roleAlreadyAssigned,
      message: 'They already have that role at that scope.',
    }),
  invalidInvitation: () =>
    new BadRequestException({
      code: c.invalidInvitation,
      message: 'This invitation is invalid or has expired. Ask an admin to send a new one.',
    }),
  alreadyActivated: () =>
    new ConflictException({
      code: c.alreadyActivated,
      message: 'This account is already activated.',
    }),
};
