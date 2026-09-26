import { AGING_BUCKETS, agingBucketFor } from '@emis/contracts';
import { describe, expect, it } from 'vitest';

import { addDays } from '../../../common/dates.js';
import { bucketDueRange, resolveRange } from './range.js';

describe('resolveRange', () => {
  it('defaults to the month so far', () =>
    expect(resolveRange({}, '2026-09-26')).toEqual({ from: '2026-09-01', to: '2026-09-26' }));
  it('keeps what it is given', () =>
    expect(resolveRange({ from: '2026-01-05', to: '2026-02-01' }, '2026-09-26')).toEqual({
      from: '2026-01-05',
      to: '2026-02-01',
    }));
  it('starts the default month from the end date when only that is given', () =>
    expect(resolveRange({ to: '2026-03-15' }, '2026-09-26')).toEqual({
      from: '2026-03-01',
      to: '2026-03-15',
    }));
  it('refuses a backwards range', () =>
    expect(() => resolveRange({ from: '2026-05-02', to: '2026-05-01' }, '2026-09-26')).toThrow(
      /must not be after/,
    ));
  it('allows a single day and refuses a range that is too long', () => {
    expect(resolveRange({ from: '2026-05-01', to: '2026-05-01' }, '2026-09-26').from).toBe(
      '2026-05-01',
    );
    expect(() => resolveRange({ from: '2020-01-01', to: '2026-01-01' }, '2026-09-26')).toThrow(
      /at most/,
    );
  });
});

describe('bucketDueRange', () => {
  const asOf = '2026-09-26';

  it('agrees with agingBucketFor for every day around each boundary', () => {
    for (let overdue = -5; overdue <= 130; overdue++) {
      const due = addDays(asOf, -overdue);
      const bucket = agingBucketFor(overdue);
      const range = bucketDueRange(bucket, asOf);
      expect(range.min === undefined || due >= range.min, `${overdue} min`).toBe(true);
      expect(range.max === undefined || due <= range.max, `${overdue} max`).toBe(true);
      // and no other bucket claims it
      for (const other of AGING_BUCKETS.filter((b) => b !== bucket)) {
        const r = bucketDueRange(other, asOf);
        const inside =
          (r.min === undefined || due >= r.min) && (r.max === undefined || due <= r.max);
        expect(inside, `${overdue} also in ${other}`).toBe(false);
      }
    }
  });
});
