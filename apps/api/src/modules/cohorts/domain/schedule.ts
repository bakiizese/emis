/** A holiday as stored: a date, whether it repeats yearly, and the branch it applies to (null = all). */
export interface HolidayRule {
  date: string;
  isRecurringAnnually: boolean;
  branchId: string | null;
}

/** More sessions than any real course has; guards against a typo like a 2076 end date. */
export const MAX_SESSIONS = 400;

/** 0 = Sunday … 6 = Saturday, for a "YYYY-MM-DD" date, independent of the server's time zone. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Does this holiday close the branch on that date? Recurring ones match month and day only. */
export function isHoliday(
  date: string,
  branchId: string,
  holidays: readonly HolidayRule[],
): boolean {
  return holidays.some(
    (h) =>
      (h.branchId === null || h.branchId === branchId) &&
      (h.isRecurringAnnually ? h.date.slice(5) === date.slice(5) : h.date === date),
  );
}

/**
 * The dates a cohort meets: every day from `startDate` to `endDate` (inclusive) whose weekday is in
 * the shift's days, except holidays. Ascending, no duplicates. Stops at MAX_SESSIONS + 1 so the
 * caller can tell "too many" without walking a huge range.
 */
export function sessionDates(input: {
  startDate: string;
  endDate: string;
  daysOfWeek: readonly number[];
  branchId: string;
  holidays: readonly HolidayRule[];
}): string[] {
  const dates: string[] = [];
  for (
    let day = input.startDate;
    day <= input.endDate && dates.length <= MAX_SESSIONS;
    day = addDays(day, 1)
  ) {
    if (!input.daysOfWeek.includes(weekdayOf(day))) continue;
    if (isHoliday(day, input.branchId, input.holidays)) continue;
    dates.push(day);
  }
  return dates;
}
