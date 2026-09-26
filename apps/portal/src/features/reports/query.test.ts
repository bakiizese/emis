import { describe, expect, it } from 'vitest';

import { barPercent, buildQuery } from './query';

describe('buildQuery', () => {
  it('leaves out anything not set', () =>
    expect(buildQuery({ from: '2026-09-01', to: '', branchId: undefined, groupBy: 'day' })).toBe(
      '?from=2026-09-01&groupBy=day',
    ));
  it('is empty when nothing is set', () => expect(buildQuery({ a: '', b: null })).toBe(''));
  it('encodes values', () => expect(buildQuery({ q: 'a b&c' })).toBe('?q=a+b%26c'));
});

describe('barPercent', () => {
  it('scales against the biggest row', () => {
    expect(barPercent(50, 100)).toBe(50);
    expect(barPercent(100, 100)).toBe(100);
  });
  it('keeps a small amount visible and zero empty', () => {
    expect(barPercent(1, 10_000)).toBe(2);
    expect(barPercent(0, 100)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
  });
});
