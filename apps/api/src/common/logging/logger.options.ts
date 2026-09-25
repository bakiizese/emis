import type { IncomingMessage } from 'node:http';

import type { Params } from 'nestjs-pino';

import type { Env } from '../../config/env.js';

/** Never written to logs, wherever they appear in a request or response. */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.secret',
];

export function loggerOptions(env: Env): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      // Fastify already assigned the id (see resolveRequestId); reuse it so logs and responses match.
      genReqId: (request: IncomingMessage) =>
        (request as IncomingMessage & { id?: string }).id ?? 'unknown',
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
      serializers: {
        req: (req: { id: string; method: string; url: string; originalUrl?: string }) => ({
          id: req.id,
          method: req.method,
          url: (req.originalUrl ?? req.url).split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // Probes hit these every few seconds; logging them would drown out real traffic.
      // Middleware sees a mount-relative req.url, so match on originalUrl.
      autoLogging: {
        ignore: (req) => {
          const url =
            (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '';
          return /^\/api\/v1\/health(\/|\?|$)/.test(url);
        },
      },
      ...(env.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { singleLine: true, ignore: 'pid,hostname' },
            },
          }
        : {}),
    },
  };
}
