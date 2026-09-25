import type { Permission } from '@emis/permissions';
import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiForbiddenResponse } from '@nestjs/swagger';

export const REQUIRED_PERMISSION = 'authz:required-permission';
export const SELF_SERVICE = 'authz:self-service';

/**
 * The permission a route needs. Every route must carry exactly one of @Public(), @SelfService()
 * or @RequirePermission(); anything else is denied at runtime and fails the route-coverage test.
 */
export const RequirePermission = (permission: Permission) =>
  applyDecorators(
    SetMetadata(REQUIRED_PERMISSION, permission),
    ApiForbiddenResponse({ description: `Requires the \`${permission}\` permission` }),
  );

/** Any signed-in person may call this route, for their own data (profile, sessions, password). */
export const SelfService = () => SetMetadata(SELF_SERVICE, true);
