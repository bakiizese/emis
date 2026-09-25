import { createHash } from 'node:crypto';

import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { idempotencyKeys } from '@emis/db';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { from, lastValueFrom, type Observable } from 'rxjs';

import type { DbAdapter } from '../../database/database.module.js';
import { canonicalJson } from '../json/canonical-json.js';
import { IDEMPOTENCY_HEADER, IDEMPOTENT, type IdempotentOptions } from './idempotent.decorator.js';

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,255}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL_MS = 24 * 3_600_000;
const HTTP_CODE_METADATA = '__httpCode__';

/**
 * Stripe-style idempotency, done with one database transaction:
 *   1. take an advisory lock on (caller, key): a concurrent duplicate waits here
 *   2. if a response is already stored, replay it (same status and body)
 *   3. otherwise run the handler and store its response in the SAME transaction as its writes
 * So the stored response exists exactly when the work committed. Errors roll everything back and
 * release the key, so a client can safely retry after a failure.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly txHost: TransactionHost<DbAdapter>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<IdempotentOptions | undefined>(IDEMPOTENT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const header = request.headers[IDEMPOTENCY_HEADER];
    const key = Array.isArray(header) ? header[0] : header;

    if (!key) {
      if (!options.required) return next.handle();
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Send an Idempotency-Key header (a UUID) with this request.',
      });
    }
    const principal = request.auth?.userId ?? 'anonymous';
    // Anonymous keys share one namespace, so they must be unguessable.
    if (!KEY_PATTERN.test(key) || (principal === 'anonymous' && !UUID_PATTERN.test(key))) {
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key must be a UUID.',
      });
    }

    const method = request.method;
    const path = request.url.split('?')[0] ?? request.url;
    const requestHash = createHash('sha256')
      .update(canonicalJson({ body: request.body ?? null, query: request.query ?? null }))
      .digest('hex');
    const status =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (method === 'POST' ? 201 : 200);

    return from(
      this.txHost.withTransaction(async () => {
        const tx = this.txHost.tx;
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${principal}), hashtext(${key}))`,
        );

        const [stored] = await tx
          .select()
          .from(idempotencyKeys)
          .where(and(eq(idempotencyKeys.principal, principal), eq(idempotencyKeys.key, key)))
          .limit(1);
        if (stored && stored.expiresAt > new Date()) {
          if (
            stored.method !== method ||
            stored.path !== path ||
            stored.requestHash !== requestHash
          ) {
            throw new UnprocessableEntityException({
              code: 'IDEMPOTENCY_KEY_REUSED',
              message: 'This Idempotency-Key was already used for a different request.',
            });
          }
          void reply.status(stored.responseStatus).header('idempotent-replayed', 'true');
          return stored.responseBody;
        }

        const result: unknown = await lastValueFrom(next.handle(), { defaultValue: undefined });
        const body = result === undefined ? null : (JSON.parse(JSON.stringify(result)) as unknown);
        await tx
          .insert(idempotencyKeys)
          .values({
            principal,
            key,
            method,
            path,
            requestHash,
            responseStatus: status,
            responseBody: body,
            expiresAt: new Date(Date.now() + TTL_MS),
          })
          .onConflictDoUpdate({
            // Only reachable when an expired row with this key is still waiting for cleanup.
            target: [idempotencyKeys.principal, idempotencyKeys.key],
            set: {
              method,
              path,
              requestHash,
              responseStatus: status,
              responseBody: body,
              createdAt: new Date(),
              expiresAt: new Date(Date.now() + TTL_MS),
            },
          });
        return result;
      }),
    );
  }
}
