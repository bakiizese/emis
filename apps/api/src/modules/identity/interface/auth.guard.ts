import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../../common/request/request-context.js';

import { SessionsService } from '../application/sessions.service.js';
import { authErrors } from '../domain/errors.js';
import { ALLOW_MFA_PENDING, IS_PUBLIC, requestContextOf } from './decorators.js';
import { SessionCookie } from './session-cookie.js';

/**
 * Global guard: every route requires a valid session unless marked @Public(). Sessions with a
 * pending second factor only reach routes marked @AllowMfaPending().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
    private readonly cookie: SessionCookie,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    // Request metadata for the audit log, set before anything can fail.
    if (this.cls.isActive())
      this.cls.set('request', { requestId: request.id, ...requestContextOf(request) });

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const token = this.cookie.read(request);
    if (!token) throw authErrors.unauthenticated();

    const auth = await this.sessions.authenticate(token);
    if (!auth) {
      this.cookie.clear(http.getResponse<FastifyReply>());
      throw authErrors.unauthenticated();
    }
    request.auth = auth;
    if (this.cls.isActive())
      this.cls.set('actor', { userId: auth.userId, email: auth.email, sessionId: auth.sessionId });

    if (
      auth.nextStep !== 'none' &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_MFA_PENDING, targets)
    ) {
      throw auth.nextStep === 'mfa' ? authErrors.mfaRequired() : authErrors.mfaEnrollmentRequired();
    }
    return true;
  }
}
