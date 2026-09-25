import { STATUS_CODES } from 'node:http';

import type { ProblemDetails } from '@emis/contracts';
import { InvalidCursorError } from '@emis/db';
import { HttpException } from '@nestjs/common';

import { ZodValidationException } from '../zod/zod-validation.js';

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  406: 'NOT_ACCEPTABLE',
  409: 'CONFLICT',
  412: 'PRECONDITION_FAILED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE',
  428: 'PRECONDITION_REQUIRED',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

/** Client errors raised by Fastify itself (bad JSON, body too large…) carry these fields. */
interface FrameworkError {
  statusCode: number;
  code?: string;
  message: string;
}

function isFrameworkClientError(error: unknown): error is FrameworkError {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return false;
  const { statusCode } = error;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500;
}

function problem(status: number, code: string, detail?: string): ProblemDetails {
  return {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    code,
    ...(detail ? { detail } : {}),
  };
}

function detailFromResponse(response: unknown): string | undefined {
  if (typeof response === 'string') return response;
  if (typeof response === 'object' && response !== null && 'message' in response) {
    const { message } = response;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.filter((m) => typeof m === 'string').join('; ');
  }
  return undefined;
}

function codeFromResponse(response: unknown): string | undefined {
  if (typeof response === 'object' && response !== null && 'code' in response) {
    const { code } = response;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code)) return code;
  }
  return undefined;
}

/**
 * Map anything thrown while handling a request to an RFC 9457 problem document.
 * Unknown errors become a generic 500 and never leak messages or stack traces.
 */
export function toProblemDetails(exception: unknown): ProblemDetails {
  if (exception instanceof ZodValidationException) {
    return {
      ...problem(400, 'VALIDATION_FAILED', 'The request contains invalid fields.'),
      errors: exception.fieldErrors,
    };
  }

  if (exception instanceof InvalidCursorError) {
    return problem(400, 'INVALID_CURSOR', 'The pagination cursor is invalid or expired.');
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const code = codeFromResponse(response) ?? DEFAULT_CODES[status] ?? `HTTP_${status}`;
    // Server-side errors only ever show a generic message.
    const detail = status >= 500 ? undefined : detailFromResponse(response);
    return problem(status, code, detail);
  }

  if (isFrameworkClientError(exception)) {
    const status = exception.statusCode;
    // Parser messages can echo request content, so keep the detail generic.
    const detail = status === 400 ? 'The request body is malformed.' : undefined;
    return problem(status, DEFAULT_CODES[status] ?? `HTTP_${status}`, detail);
  }

  return problem(500, 'INTERNAL_ERROR', 'Something went wrong on our side.');
}
