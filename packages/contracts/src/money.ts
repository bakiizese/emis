import { z } from 'zod';

/**
 * Money is a whole number of the smallest unit (santim for birr, cents for dollars), never a float.
 * 10 billion birr is far above any real invoice and far below where JavaScript numbers lose
 * exactness, so sums of many amounts stay exact.
 */
export const MAX_MINOR_UNITS = 1_000_000_000_000;

export const minorUnitsSchema = z.number().int().min(0).max(MAX_MINOR_UNITS);
export const positiveMinorUnitsSchema = z.number().int().min(1).max(MAX_MINOR_UNITS);

export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z]{3}$/));

/** "1,500.50" or "1500" (whole units, as a person types it) → 150050 minor units, or null if unusable. */
export function parseMoney(input: string): number | null {
  const cleaned = input.trim().replace(/[,\s]/g, '');
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = Number(match[1]);
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  const total = whole * 100 + cents;
  return total <= MAX_MINOR_UNITS ? total : null;
}

/** 150050, "ETB" → "ETB 1,500.50". Display only: never parse this back. */
export function formatMoney(minorUnits: number, currency: string, locale = 'en'): string {
  const sign = minorUnits < 0 ? '-' : '';
  const abs = Math.abs(minorUnits);
  const units = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.floor(abs / 100) + (abs % 100) / 100);
  return `${sign}${currency} ${units}`;
}

/**
 * Split `total` by shares in basis points (10 000 = 100 %) into whole minor units that add up to
 * exactly `total`: every part is rounded down and the leftover goes to the last part, so 100.00
 * split in thirds is 33.33 + 33.33 + 33.34. Uses BigInt so a large total can't lose precision.
 */
export function splitByBasisPoints(total: number, shares: readonly number[]): number[] {
  if (shares.length === 0) throw new Error('Need at least one share');
  const sum = shares.reduce((a, b) => a + b, 0);
  if (sum !== 10_000) throw new Error('Shares must add up to 10000 basis points');
  const parts = shares.map((bp) => Number((BigInt(total) * BigInt(bp)) / 10_000n));
  const allocated = parts.reduce((a, b) => a + b, 0);
  parts[parts.length - 1] = (parts[parts.length - 1] ?? 0) + (total - allocated);
  return parts;
}
