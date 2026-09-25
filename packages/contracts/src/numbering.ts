import { z } from 'zod';

/**
 * Human-readable document numbers (student numbers, receipts, invoices) are built from a pattern:
 *
 *   RCP-{BRANCH}-{YYYY}-{SEQ:6}  →  RCP-BOLE-2026-000042
 *
 * Everything except {SEQ:n} forms the counter scope, so a pattern with {YYYY} restarts every
 * calendar year, {FY} every fiscal year, and one with {BRANCH} counts per branch. Counters are gapless (see NumberingService in the API).
 */
export const NUMBER_TOKENS = ['YYYY', 'YY', 'MM', 'FY', 'BRANCH'] as const;
export type NumberToken = (typeof NUMBER_TOKENS)[number];

const TOKEN_RE = /\{([A-Z]+)(?::(\d+))?\}/g;
const LITERAL_RE = /^[A-Za-z0-9\-/_.]*$/;

export interface NumberContext {
  /** Calendar parts in the institution's timezone. */
  year: number;
  month: number;
  /** The calendar year the current fiscal year started in. */
  fiscalYear: number;
  branchCode?: string;
}

export type PatternProblem = string | null;

/** Why a pattern is unusable, or null when it's fine. */
export function checkNumberPattern(pattern: string): PatternProblem {
  let seqCount = 0;
  let rest = pattern;
  for (const match of pattern.matchAll(TOKEN_RE)) {
    const [whole, token, width] = match;
    if (token === 'SEQ') {
      seqCount += 1;
      const n = Number(width);
      if (!width || n < 1 || n > 12) return 'Use {SEQ:n} with n between 1 and 12, e.g. {SEQ:5}.';
    } else if (!(NUMBER_TOKENS as readonly string[]).includes(token ?? '') || width) {
      return `Unknown placeholder ${whole}. Use ${NUMBER_TOKENS.map((t) => `{${t}}`).join(', ')} or {SEQ:n}.`;
    }
    rest = rest.replace(whole, '');
  }
  if (seqCount !== 1) return 'The pattern needs exactly one {SEQ:n} placeholder.';
  if (!LITERAL_RE.test(rest))
    return 'Only letters, digits and - / _ . are allowed around placeholders.';
  return null;
}

export const numberPatternSchema = z
  .string()
  .trim()
  .min(5)
  .max(60)
  .superRefine((pattern, ctx) => {
    const problem = checkNumberPattern(pattern);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

export function patternUsesBranch(pattern: string): boolean {
  return pattern.includes('{BRANCH}');
}

function fill(pattern: string, ctx: NumberContext, seq: string): string {
  return pattern.replace(TOKEN_RE, (_whole, token: string) => {
    switch (token) {
      case 'YYYY':
        return String(ctx.year);
      case 'YY':
        return String(ctx.year % 100).padStart(2, '0');
      case 'MM':
        return String(ctx.month).padStart(2, '0');
      case 'FY':
        return String(ctx.fiscalYear);
      case 'BRANCH':
        if (!ctx.branchCode) throw new Error('This number pattern needs a branch');
        return ctx.branchCode;
      default:
        return seq;
    }
  });
}

/** The counter key: the pattern rendered with everything except the sequence. */
export function numberScope(pattern: string, ctx: NumberContext): string {
  return fill(pattern, ctx, '{SEQ}');
}

export function formatNumber(pattern: string, ctx: NumberContext, sequence: number): string {
  const width = Number(/\{SEQ:(\d+)\}/.exec(pattern)?.[1] ?? 1);
  return fill(pattern, ctx, String(sequence).padStart(width, '0'));
}
