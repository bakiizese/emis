import { describe, expect, it } from 'vitest';

import { isHoliday, MAX_SESSIONS, sessionDates, weekdayOf } from './schedule.js';

describe('weekdayOf', () => {
  it('reads the calendar day, not the local time zone', () => {
    expect(weekdayOf('2026-09-14')).toBe(1); // Monday
    expect(weekdayOf('2026-09-13')).toBe(0); // Sunday
    expect(weekdayOf('2026-09-19')).toBe(6); // Saturday
  });
});

describe('isHoliday', () => {
  const holidays = [
    { date: '2026-09-27', isRecurringAnnually: false, branchId: null },
    { date: '2026-01-07', isRecurringAnnually: true, branchId: null },
    { date: '2026-10-01', isRecurringAnnually: false, branchId: 'bole' },
  ];

  it('matches a one-off holiday only on its own date', () => {
    expect(isHoliday('2026-09-27', 'bole', holidays)).toBe(true);
    expect(isHoliday('2027-09-27', 'bole', holidays)).toBe(false);
  });

  it('matches a yearly holiday in every year', () => {
    expect(isHoliday('2029-01-07', 'bole', holidays)).toBe(true);
  });

  it('applies a branch holiday to that branch only', () => {
    expect(isHoliday('2026-10-01', 'bole', holidays)).toBe(true);
    expect(isHoliday('2026-10-01', 'piassa', holidays)).toBe(false);
  });
});

describe('sessionDates', () => {
  const base = { branchId: 'bole', holidays: [] };

  it('lists the shift days in the range, inclusive of both ends', () => {
    // Mon/Wed/Fri from Mon 14 Sep to Fri 25 Sep 2026.
    expect(
      sessionDates({
        ...base,
        startDate: '2026-09-14',
        endDate: '2026-09-25',
        daysOfWeek: [1, 3, 5],
      }),
    ).toEqual(['2026-09-14', '2026-09-16', '2026-09-18', '2026-09-21', '2026-09-23', '2026-09-25']);
  });

  it('skips holidays', () => {
    const dates = sessionDates({
      ...base,
      startDate: '2026-09-14',
      endDate: '2026-09-25',
      daysOfWeek: [1, 3, 5],
      holidays: [{ date: '2026-09-16', isRecurringAnnually: false, branchId: null }],
    });
    expect(dates).not.toContain('2026-09-16');
    expect(dates).toHaveLength(5);
  });

  it('is empty when no shift day falls in the range, and for a reversed range', () => {
    expect(
      sessionDates({ ...base, startDate: '2026-09-14', endDate: '2026-09-14', daysOfWeek: [2] }),
    ).toEqual([]);
    expect(
      sessionDates({ ...base, startDate: '2026-09-25', endDate: '2026-09-14', daysOfWeek: [1] }),
    ).toEqual([]);
  });

  it('stops just past the cap instead of walking a huge range', () => {
    const dates = sessionDates({
      ...base,
      startDate: '2026-01-01',
      endDate: '2099-12-31',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    });
    expect(dates).toHaveLength(MAX_SESSIONS + 1);
  });

  it('handles month and year boundaries', () => {
    expect(
      sessionDates({
        ...base,
        startDate: '2026-12-30',
        endDate: '2027-01-02',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      }),
    ).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });
});
