import { InvalidCursorError } from '@emis/db';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ZodValidationException } from '../zod/zod-validation.js';
import { toProblemDetails } from './problem-details.js';

describe('toProblemDetails', () => {
  it('maps validation errors to 400 with field paths', () => {
    const result = z
      .object({ email: z.email(), age: z.number() })
      .safeParse({ email: 'nope', age: 'x' });
    if (result.success) throw new Error('expected failure');

    const problem = toProblemDetails(new ZodValidationException(result.error));

    expect(problem).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', title: 'Bad Request' });
    expect(problem.errors?.map((e) => e.path)).toEqual(['email', 'age']);
  });

  it('keeps an explicit machine-readable code from the exception', () => {
    const problem = toProblemDetails(
      new ConflictException({ code: 'ENROLLMENT_COHORT_FULL', message: 'The cohort is full.' }),
    );
    expect(problem).toMatchObject({
      status: 409,
      code: 'ENROLLMENT_COHORT_FULL',
      detail: 'The cohort is full.',
    });
  });

  it('falls back to a default code per status', () => {
    expect(toProblemDetails(new NotFoundException('Student not found'))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      detail: 'Student not found',
    });
  });

  it('maps invalid cursors to 400', () => {
    expect(toProblemDetails(new InvalidCursorError())).toMatchObject({
      status: 400,
      code: 'INVALID_CURSOR',
    });
  });

  it('never exposes details of server-side errors', () => {
    const fromHttp = toProblemDetails(new ServiceUnavailableException('db at 10.0.0.5 refused'));
    expect(fromHttp).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(fromHttp.detail).toBeUndefined();

    const unknown = toProblemDetails(new Error('password=hunter2'));
    expect(unknown).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(unknown)).not.toContain('hunter2');
  });

  it('keeps framework parser errors generic', () => {
    const problem = toProblemDetails({
      statusCode: 400,
      code: 'FST_ERR_CTP_INVALID_JSON',
      message: 'Unexpected token s',
    });
    expect(problem).toMatchObject({
      status: 400,
      code: 'BAD_REQUEST',
      detail: 'The request body is malformed.',
    });
  });
});
