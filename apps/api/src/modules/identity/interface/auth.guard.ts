import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { SessionsService } from '../application/sessions.service.js';
import { authErrors } from '../domain/errors.js';
import { ALLOW_MFA_PENDING, IS_PUBLIC } from './decorators.js';
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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const token = this.cookie.read(request);
    if (!token) throw authErrors.unauthenticated();

    const auth = await this.sessions.authenticate(token);
    if (!auth) {
      this.cookie.clear(http.getResponse<FastifyReply>());
      throw authErrors.unauthenticated();
    }
    request.auth = auth;

    if (
      auth.nextStep !== 'none' &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_MFA_PENDING, targets)
    ) {
      throw auth.nextStep === 'mfa' ? authErrors.mfaRequired() : authErrors.mfaEnrollmentRequired();
    }
    return true;
  }
}
