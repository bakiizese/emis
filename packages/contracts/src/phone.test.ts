import { describe, expect, it } from 'vitest';

import { normalizePhone, optionalPhoneSchema, phoneSchema } from './phone.js';

describe('normalizePhone', () => {
  it.each([
    ['0911223344', '+251911223344'],
    ['0911 22 33 44', '+251911223344'],
    ['+251 911-223344', '+251911223344'],
    ['251911223344', '+251911223344'],
    ['911223344', '+251911223344'],
    ['00251911223344', '+251911223344'],
    ['(0911) 223344', '+251911223344'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', 'abc', '12', '0911-abc', '+', '+1234567890123456', '09 11 <script>'])(
    'rejects %j',
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );

  it('uses another calling code when given one', () => {
    expect(normalizePhone('0712345678', '254')).toBe('+254712345678');
  });
});

describe('phone schemas', () => {
  it('normalizes and reports an unusable number', () => {
    expect(phoneSchema.parse(' 0911223344 ')).toBe('+251911223344');
    expect(phoneSchema.safeParse('nope').success).toBe(false);
  });

  it('lets an optional phone be empty', () => {
    expect(optionalPhoneSchema.parse('')).toBeNull();
    expect(optionalPhoneSchema.parse('0911223344')).toBe('+251911223344');
    expect(optionalPhoneSchema.safeParse('x').success).toBe(false);
  });
});
