import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { formatMoney, MAX_MINOR_UNITS, parseMoney, splitByBasisPoints } from './money.js';

describe('parseMoney', () => {
  it.each([
    ['1500', 150000],
    ['1,500.50', 150050],
    ['0.5', 50],
    ['0.05', 5],
    [' 12 000.00 ', 1200000],
    ['0', 0],
  ])('%s → %d', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each(['', 'abc', '1.234', '-5', '1e3', '12.', '.5', '9'.repeat(14)])('rejects %j', (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it('round-trips whole and fractional amounts exactly', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_MINOR_UNITS }), (minor) => {
        const text = `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
        expect(parseMoney(text)).toBe(minor);
      }),
    );
  });
});

describe('formatMoney', () => {
  it('shows two decimals and grouping', () => {
    expect(formatMoney(150050, 'ETB')).toBe('ETB 1,500.50');
    expect(formatMoney(5, 'ETB')).toBe('ETB 0.05');
    expect(formatMoney(0, 'ETB')).toBe('ETB 0.00');
    expect(formatMoney(-2500, 'ETB')).toBe('-ETB 25.00');
  });
});

describe('splitByBasisPoints', () => {
  it('splits into thirds without losing a santim', () => {
    expect(splitByBasisPoints(10000, [3333, 3333, 3334])).toEqual([3333, 3333, 3334]);
    expect(splitByBasisPoints(10000, [3333, 3333, 3334]).reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it('gives the rounding leftover to the last part', () => {
    expect(splitByBasisPoints(101, [5000, 5000])).toEqual([50, 51]);
    expect(splitByBasisPoints(1, [5000, 5000])).toEqual([0, 1]);
  });

  it('always adds up exactly, for any total and any split', () => {
    const shares = fc
      .array(fc.integer({ min: 1, max: 9999 }), { minLength: 1, maxLength: 12 })
      .map((raw) => {
        // Turn arbitrary weights into shares that add up to exactly 10 000.
        const total = raw.reduce((a, b) => a + b, 0);
        const scaled = raw.map((w) => Math.floor((w * 10_000) / total));
        scaled[scaled.length - 1] =
          (scaled[scaled.length - 1] ?? 0) + (10_000 - scaled.reduce((a, b) => a + b, 0));
        return scaled;
      });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_MINOR_UNITS }), shares, (total, split) => {
        const parts = splitByBasisPoints(total, split);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
      }),
    );
  });

  it('rejects shares that do not add up', () => {
    expect(() => splitByBasisPoints(100, [5000, 4000])).toThrow();
    expect(() => splitByBasisPoints(100, [])).toThrow();
  });
});
