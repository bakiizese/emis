import { AUTH_ERROR_CODES } from '@emis/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { PROBLEM_CONTENT_TYPE } from '../../../common/http/problem-details.filter.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie sessions (on top of SameSite=Lax): state-changing requests must come
 * from our own origin or a trusted frontend. Browsers always send Sec-Fetch-Site and/or Origin on
 * these requests; non-browser clients send neither and carry no ambient cookies to abuse.
 */
export function isCrossSiteRequest(
  request: FastifyRequest,
  trustedOrigins: readonly string[],
): boolean {
  if (SAFE_METHODS.has(request.method)) return false;

  const origin = request.headers.origin;
  const originTrusted = typeof origin === 'string' && trustedOrigins.includes(origin);
  const ownOrigin = `${request.protocol}://${request.host}`;

  const fetchSite = request.headers['sec-fetch-site'];
  if (
    typeof fetchSite === 'string' &&
    fetchSite !== 'same-origin' &&
    fetchSite !== 'none' &&
    !originTrusted
  ) {
    return true;
  }
  return typeof origin === 'string' && !originTrusted && origin !== ownOrigin;
}

export function registerCsrfProtection(
  fastify: FastifyInstance,
  trustedOrigins: readonly string[],
): void {
  fastify.addHook('onRequest', (request, reply, done) => {
    if (!isCrossSiteRequest(request, trustedOrigins)) {
      done();
      return;
    }
    void reply
      .code(403)
      .header('content-type', PROBLEM_CONTENT_TYPE)
      .send({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        code: AUTH_ERROR_CODES.csrfRejected,
        detail: 'Cross-site request rejected.',
        instance: request.url.split('?')[0],
        requestId: request.id,
      });
  });
}
