import { z } from 'zod';

/** Calling codes for the countries an install is configured for. Others must type "+code…". */
export const CALLING_CODES: Record<string, string> = { ET: '251' };

const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/**
 * A phone number as "+<digits>" (E.164 shape) so the same person's number always compares equal
 * however it was typed: "0911 22 33 44", "+251 911-223344" and "251911223344" all become
 * "+251911223344". Returns null when it can't be a phone number.
 */
export function normalizePhone(
  input: string,
  callingCode = CALLING_CODES.ET ?? '251',
): string | null {
  const trimmed = input.trim();
  if (!/^[+\d(][\d\s().-]*$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');

  let full: string;
  if (trimmed.startsWith('+')) full = digits;
  else if (digits.startsWith('00')) full = digits.slice(2);
  else if (digits.startsWith('0')) full = callingCode + digits.slice(1);
  else if (digits.startsWith(callingCode)) full = digits;
  else full = callingCode + digits;

  return full.length >= MIN_DIGITS && full.length <= MAX_DIGITS ? `+${full}` : null;
}

export const phoneSchema = z
  .string()
  .trim()
  .max(30)
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number, e.g. 0911 22 33 44' });
      return z.NEVER;
    }
    return normalized;
  });

/** Optional phone: empty becomes null. */
export const optionalPhoneSchema = z
  .union([z.literal(''), phoneSchema])
  .transform((value) => (value === '' ? null : value))
  .nullable();
