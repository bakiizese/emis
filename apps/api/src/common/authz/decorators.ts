import type { Grant, Permission } from '@emis/permissions';
import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { ApiForbiddenResponse } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

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

/**
 * Every permission the caller holds, at every scope (populated by PermissionGuard). Services use
 * this with `assertScope()` to check a record's branch/department, on top of the route-level check.
 */
export const CurrentGrants = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Grant[] =>
    ctx.switchToHttp().getRequest<FastifyRequest>().grants ?? [],
);
