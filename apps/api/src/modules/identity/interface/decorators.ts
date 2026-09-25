import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { authErrors } from '../domain/errors.js';
import type { AuthContext, RequestContext } from '../domain/types.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export const IS_PUBLIC = 'identity:public';
export const ALLOW_MFA_PENDING = 'identity:allow-mfa-pending';

/** Route needs no session (login, password reset, health). Everything else requires one. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route is reachable while the second factor is still pending (MFA verify/enroll, me, logout). */
export const AllowMfaPending = () => SetMetadata(ALLOW_MFA_PENDING, true);

/** The authenticated caller. Only valid on non-public routes. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    if (!request.auth) throw authErrors.unauthenticated();
    return request.auth;
  },
);

export function requestContextOf(request: FastifyRequest): RequestContext {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip || null,
    userAgent:
      typeof userAgent === 'string' && userAgent.length > 0 ? userAgent.slice(0, 512) : null,
  };
}

/** Client IP (proxy-aware when TRUST_PROXY is on) and user agent, for security events and sessions. */
export const ReqContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext =>
    requestContextOf(ctx.switchToHttp().getRequest<FastifyRequest>()),
);
