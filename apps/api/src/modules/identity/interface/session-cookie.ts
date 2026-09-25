import { Inject, Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { APP_CONFIG } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.js';

/**
 * `__Host-` cookie: Secure, Path=/, no Domain, so no subdomain can set or read it. HttpOnly keeps it
 * away from scripts. No Max-Age: it ends with the browser session (shared front-desk PCs), and the
 * server enforces idle and absolute timeouts anyway.
 */
@Injectable()
export class SessionCookie {
  private readonly options = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

  constructor(@Inject(APP_CONFIG) private readonly env: Env) {}

  read(request: FastifyRequest): string | undefined {
    return request.cookies[this.env.SESSION_COOKIE_NAME];
  }

  set(reply: FastifyReply, token: string): void {
    void reply.setCookie(this.env.SESSION_COOKIE_NAME, token, this.options);
  }

  clear(reply: FastifyReply): void {
    void reply.clearCookie(this.env.SESSION_COOKIE_NAME, this.options);
  }
}
