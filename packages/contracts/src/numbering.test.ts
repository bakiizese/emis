import { describe, expect, it } from 'vitest';

import { checkNumberPattern, formatNumber, numberPatternSchema, numberScope } from './numbering.js';

const ctx = { year: 2026, month: 9, fiscalYear: 2026, branchCode: 'BOLE' };

describe('number patterns', () => {
  it('formats every placeholder', () => {
    expect(formatNumber('RCP-{BRANCH}-{FY}-{SEQ:6}', ctx, 42)).toBe('RCP-BOLE-2026-000042');
    expect(formatNumber('APP-{YY}{MM}-{SEQ:4}', ctx, 7)).toBe('APP-2609-0007');
    expect(formatNumber('S{YYYY}/{SEQ:3}', ctx, 12345)).toBe('S2026/12345');
  });

  it('scopes the counter by everything except the sequence', () => {
    expect(numberScope('RCP-{BRANCH}-{FY}-{SEQ:6}', ctx)).toBe('RCP-BOLE-2026-{SEQ}');
    expect(numberScope('RCP-{BRANCH}-{FY}-{SEQ:6}', { ...ctx, branchCode: 'PIAZ' })).not.toBe(
      numberScope('RCP-{BRANCH}-{FY}-{SEQ:6}', ctx),
    );
    // Changing only the padding keeps counting from the same counter.
    expect(numberScope('STU-{YYYY}-{SEQ:5}', ctx)).toBe(numberScope('STU-{YYYY}-{SEQ:7}', ctx));
  });

  it('needs a branch when the pattern uses one', () => {
    expect(() => formatNumber('{BRANCH}-{SEQ:3}', { ...ctx, branchCode: undefined }, 1)).toThrow();
  });

  it.each([
    ['STU-{SEQ:5}', null],
    ['STU-{YYYY}', 'exactly one {SEQ:n}'],
    ['{SEQ:3}-{SEQ:3}', 'exactly one {SEQ:n}'],
    ['STU-{SEQ}', 'between 1 and 12'],
    ['STU-{SEQ:20}', 'between 1 and 12'],
    ['STU-{DAY}-{SEQ:4}', 'Unknown placeholder {DAY}'],
    ['STU <{SEQ:4}>', 'Only letters'],
  ])('checks %s', (pattern, problem) => {
    const result = checkNumberPattern(pattern);
    if (problem === null) expect(result).toBeNull();
    else expect(result).toContain(problem);
  });

  it('rejects unusable patterns in the request schema', () => {
    expect(numberPatternSchema.safeParse('INV-{FY}-{SEQ:6}').success).toBe(true);
    expect(numberPatternSchema.safeParse('INV-{FY}').success).toBe(false);
  });
});
