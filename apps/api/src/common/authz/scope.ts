import { ACCESS_ERROR_CODES } from '@emis/contracts';
import { type Grant, hasPermission, type Permission, type Target } from '@emis/permissions';
import { ForbiddenException } from '@nestjs/common';

/**
 * Record-level authorization on top of the route-level check: the route guard only checks that the
 * caller holds `permission` *somewhere*; this checks they hold it at `target`'s branch/department
 * (or globally). Call it in the service, after loading the record whose scope you're checking.
 */
export function assertScope(
  grants: readonly Grant[],
  permission: Permission,
  target?: Target,
): void {
  if (!hasPermission(grants, permission, target)) {
    throw new ForbiddenException({
      code: ACCESS_ERROR_CODES.permissionDenied,
      message: "You don't have permission to do that.",
    });
  }
}
