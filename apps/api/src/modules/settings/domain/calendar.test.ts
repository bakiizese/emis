import { describe, expect, it } from 'vitest';

import { calendarParts, fiscalYearOf, numberContextAt } from './calendar.js';

describe('calendar helpers', () => {
  it('reads the date on the institution wall clock', () => {
    // 22:30 UTC on 31 Dec is already 1 Jan in Addis Ababa (UTC+3).
    const at = new Date('2026-12-31T22:30:00Z');
    expect(calendarParts(at, 'Africa/Addis_Ababa')).toEqual({ year: 2027, month: 1, day: 1 });
    expect(calendarParts(at, 'UTC')).toEqual({ year: 2026, month: 12, day: 31 });
  });

  it('finds the fiscal year (Ethiopian FY starts 8 July)', () => {
    expect(fiscalYearOf({ year: 2026, month: 7, day: 7 }, '07-08')).toBe(2025);
    expect(fiscalYearOf({ year: 2026, month: 7, day: 8 }, '07-08')).toBe(2026);
    expect(fiscalYearOf({ year: 2026, month: 1, day: 1 }, '01-01')).toBe(2026);
  });

  it('builds a number context', () => {
    const ctx = numberContextAt(
      new Date('2026-03-15T09:00:00Z'),
      { timezone: 'Africa/Addis_Ababa', fiscalYearStart: '07-08' },
      'MAIN',
    );
    expect(ctx).toEqual({ year: 2026, month: 3, fiscalYear: 2025, branchCode: 'MAIN' });
  });
});
