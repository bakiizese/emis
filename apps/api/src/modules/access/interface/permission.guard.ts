import { type Grant, hasPermission, type Permission } from '@emis/permissions';
import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { REQUIRED_PERMISSION, SELF_SERVICE } from '../../../common/authz/decorators.js';
import { IS_PUBLIC } from '../../identity/index.js';
import { AccessService } from '../application/access.service.js';
import { accessErrors } from '../domain/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    grants?: Grant[];
  }
}

/**
 * Global guard, after the AuthGuard. Deny by default: a route passes only if it is @Public(),
 * @SelfService(), or declares @RequirePermission(p) and the caller holds p at some scope.
 * Record-level scope checks (this branch, that department) happen in the services.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SELF_SERVICE, targets)) return true;

    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED_PERMISSION,
      targets,
    );
    if (!permission) {
      // A route nobody declared access rules for: refuse it and make the mistake loud.
      this.logger.error(
        `Route ${context.getClass().name}.${context.getHandler().name} declares no access rule`,
      );
      throw accessErrors.permissionDenied();
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!request.auth) throw accessErrors.permissionDenied();
    request.grants ??= await this.access.grantsFor(request.auth.userId);
    if (!hasPermission(request.grants, permission)) throw accessErrors.permissionDenied();
    return true;
  }
}
