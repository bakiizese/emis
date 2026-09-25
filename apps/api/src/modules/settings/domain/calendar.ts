import type { NumberContext } from '@emis/contracts';

/** Year, month and day of `at` on the wall clock in `timeZone`. */
export function calendarParts(
  at: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** The calendar year the fiscal year containing `at` started in (start given as MM-DD). */
export function fiscalYearOf(
  parts: { year: number; month: number; day: number },
  fiscalYearStart: string,
): number {
  const [month = 1, day = 1] = fiscalYearStart.split('-').map(Number);
  const beforeStart = parts.month < month || (parts.month === month && parts.day < day);
  return beforeStart ? parts.year - 1 : parts.year;
}

export function numberContextAt(
  at: Date,
  institution: { timezone: string; fiscalYearStart: string },
  branchCode?: string,
): NumberContext {
  const parts = calendarParts(at, institution.timezone);
  return {
    year: parts.year,
    month: parts.month,
    fiscalYear: fiscalYearOf(parts, institution.fiscalYearStart),
    branchCode,
  };
}
