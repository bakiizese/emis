import { type AgingBucket, MAX_REPORT_DAYS } from '@emis/contracts';
import { UnprocessableEntityException } from '@nestjs/common';

import { addDays } from '../../../common/dates.js';

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The dates a report covers: the month so far unless told otherwise, and never absurdly long. */
export function resolveRange(
  input: { from?: string; to?: string },
  today: string,
): { from: string; to: string } {
  const to = input.to ?? today;
  const from = input.from ?? `${to.slice(0, 7)}-01`;
  if (from > to) {
    throw new UnprocessableEntityException({
      code: 'INVALID_DATE_RANGE',
      message: 'The start date must not be after the end date.',
    });
  }
  if (daysBetween(from, to) + 1 > MAX_REPORT_DAYS) {
    throw new UnprocessableEntityException({
      code: 'DATE_RANGE_TOO_LARGE',
      message: `Pick a range of at most ${MAX_REPORT_DAYS} days.`,
    });
  }
  return { from, to };
}

/** The due dates that put an instalment in `bucket` on `asOf` (either end may be open). */
export function bucketDueRange(bucket: AgingBucket, asOf: string): { min?: string; max?: string } {
  switch (bucket) {
    case 'not_due':
      return { min: asOf };
    case 'd1_30':
      return { min: addDays(asOf, -30), max: addDays(asOf, -1) };
    case 'd31_60':
      return { min: addDays(asOf, -60), max: addDays(asOf, -31) };
    case 'd61_90':
      return { min: addDays(asOf, -90), max: addDays(asOf, -61) };
    case 'd90_plus':
      return { max: addDays(asOf, -91) };
  }
}
