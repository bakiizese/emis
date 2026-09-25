import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

export const IDEMPOTENT = 'idempotency:options';
export const IDEMPOTENCY_HEADER = 'idempotency-key';

export interface IdempotentOptions {
  /** Reject requests without an Idempotency-Key (use for anything that moves money or creates records). */
  required: boolean;
}

/**
 * Safe to retry: a repeated request with the same Idempotency-Key returns the first response
 * instead of doing the work again. Pair with a client that reuses the key for retries.
 */
export const Idempotent = (options: IdempotentOptions = { required: true }) =>
  applyDecorators(
    SetMetadata(IDEMPOTENT, options),
    ApiHeader({
      name: 'Idempotency-Key',
      required: options.required,
      description:
        'Unique per logical operation (a UUID). Retries with the same key replay the first response.',
    }),
  );
