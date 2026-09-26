import { describe, expect, it } from 'vitest';

import { firstOfMonth, previousMonth } from './months.js';

describe('previousMonth', () => {
  it.each([
    ['2026-09-26', '2026-08-01', '2026-08-31'],
    ['2026-03-01', '2026-02-01', '2026-02-28'],
    ['2028-03-15', '2028-02-01', '2028-02-29'],
    ['2026-01-10', '2025-12-01', '2025-12-31'],
    ['2026-05-31', '2026-04-01', '2026-04-30'],
  ])('%s → %s to %s', (today, from, to) => expect(previousMonth(today)).toEqual({ from, to }));
});

describe('firstOfMonth', () => {
  it('is the first day of the same month', () =>
    expect(firstOfMonth('2026-09-26')).toBe('2026-09-01'));
});
