import { describe, expect, it } from 'vitest';

import { daysUntil, monthComparison, occupancyPercent, startsIn } from './figures';

describe('occupancyPercent', () => {
  it('rounds and caps', () => {
    expect(occupancyPercent(5, 12)).toBe(42);
    expect(occupancyPercent(13, 12)).toBe(100);
  });
  it('is zero with no seats', () => expect(occupancyPercent(3, 0)).toBe(0));
});

describe('monthComparison', () => {
  it.each([
    [120, 100, 'up 20% on last month'],
    [80, 100, 'down 20% on last month'],
    [100, 100, 'same as last month'],
    [50, 0, 'nothing collected last month'],
    [0, 0, 'nothing collected yet'],
  ])('%i vs %i → %s', (now, before, text) => expect(monthComparison(now, before)).toBe(text));
});

describe('startsIn / daysUntil', () => {
  it('says it in words', () => {
    expect(startsIn(0)).toBe('Starts today');
    expect(startsIn(1)).toBe('Starts tomorrow');
    expect(startsIn(5)).toBe('Starts in 5 days');
  });
  it('counts calendar days', () => expect(daysUntil('2026-10-01', '2026-09-26')).toBe(5));
});
