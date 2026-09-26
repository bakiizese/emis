import { addDays } from '../../../common/dates.js';

/** The first and last day of the calendar month before the one `today` ("YYYY-MM-DD") falls in. */
export function previousMonth(today: string): { from: string; to: string } {
  const firstOfThis = `${today.slice(0, 7)}-01`;
  const to = addDays(firstOfThis, -1);
  return { from: `${to.slice(0, 7)}-01`, to };
}

export const firstOfMonth = (today: string): string => `${today.slice(0, 7)}-01`;
