import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { zodDto, ZodValidationException, ZodValidationPipe } from './zod-validation.js';

const schema = z.object({ name: z.string().trim().min(2) });
class NameDto extends zodDto(schema) {}

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe();

  it('validates and transforms parameters typed with a zodDto class', () => {
    expect(pipe.transform({ name: '  Abebe  ' }, { type: 'body', metatype: NameDto })).toEqual({
      name: 'Abebe',
    });
  });

  it('throws a ZodValidationException with field errors', () => {
    expect(() => pipe.transform({ name: 'A' }, { type: 'body', metatype: NameDto })).toThrow(
      ZodValidationException,
    );
  });

  it('passes through parameters without a schema', () => {
    expect(pipe.transform('raw', { type: 'param', metatype: String })).toBe('raw');
  });

  it('uses an explicit schema when given one', () => {
    const explicit = new ZodValidationPipe(z.coerce.number().int());
    expect(explicit.transform('42', { type: 'query' })).toBe(42);
  });
});
