import { COMMON_ERROR_CODES } from '@emis/contracts';
import type { VersionedUpdateResult } from '@emis/db';
import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiHeader, ApiResponse } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

const IF_MATCH_RE = /^(?:W\/)?"?(\d{1,9})"?$/;

export function versionRequired(): HttpException {
  return new HttpException(
    {
      code: COMMON_ERROR_CODES.versionRequired,
      message: 'Send the version you last read in an If-Match header.',
    },
    HttpStatus.PRECONDITION_REQUIRED,
  );
}

export function versionConflict(): HttpException {
  return new HttpException(
    {
      code: COMMON_ERROR_CODES.versionConflict,
      message: 'Someone else changed this in the meantime. Reload and try again.',
    },
    HttpStatus.PRECONDITION_FAILED,
  );
}

/** The version from `If-Match: "3"` (weak tags accepted). 428 when missing or malformed. */
export const IfMatchVersion = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const header = ctx.switchToHttp().getRequest<FastifyRequest>().headers['if-match'];
  const match = typeof header === 'string' ? IF_MATCH_RE.exec(header.trim()) : null;
  if (!match?.[1]) throw versionRequired();
  return Number(match[1]);
});

/** OpenAPI docs for a route that takes @IfMatchVersion(). */
export const ApiIfMatch = () =>
  applyDecorators(
    ApiHeader({
      name: 'If-Match',
      required: true,
      description: 'The `version` of the record you read, e.g. `"3"`.',
    }),
    ApiResponse({ status: 412, description: 'The record changed since you read it' }),
    ApiResponse({ status: 428, description: 'If-Match header missing' }),
  );

/** Map an `updateWithVersion` result to the row, 404 or 412. */
export function versionedRow<T>(result: VersionedUpdateResult<T>, notFound: () => Error): T {
  if (result.status === 'not_found') throw notFound();
  if (result.status === 'conflict') throw versionConflict();
  return result.row;
}
