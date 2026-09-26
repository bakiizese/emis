import { describe, expect, it } from 'vitest';

import { isoToLocalInput, localInputToIso } from './post-time';

describe('post time helpers', () => {
  it('turns an empty or broken input into nothing', () => {
    expect(localInputToIso('')).toBeNull();
    expect(localInputToIso('not a date')).toBeNull();
  });

  it('round-trips a moment through the input format', () => {
    const iso = '2026-09-26T05:30:00.000Z';
    expect(localInputToIso(isoToLocalInput(iso))).toBe(iso);
  });
});
