export interface CompletionRules {
  minAttendancePercent: number | null;
  minScore: number | null;
}

export interface EnrollmentResult {
  score: number | null;
  attendancePercent: number | null;
}

export type CompletionOutcome =
  | { kind: 'incomplete'; missing: ('score' | 'attendancePercent')[] }
  | { kind: 'passed' }
  | { kind: 'failed'; reasons: ('score' | 'attendancePercent')[] };

/**
 * Apply a course's completion rules to a result. A rule that exists needs its number (otherwise
 * the result is `incomplete`, not a fail); a rule that doesn't exist is ignored. Passing means
 * every rule is met, with the minimum itself counting as met.
 */
export function evaluateCompletion(
  rules: CompletionRules,
  result: EnrollmentResult,
): CompletionOutcome {
  const missing: ('score' | 'attendancePercent')[] = [];
  if (rules.minScore !== null && result.score === null) missing.push('score');
  if (rules.minAttendancePercent !== null && result.attendancePercent === null) {
    missing.push('attendancePercent');
  }
  if (missing.length > 0) return { kind: 'incomplete', missing };

  const reasons: ('score' | 'attendancePercent')[] = [];
  if (rules.minScore !== null && (result.score ?? 0) < rules.minScore) reasons.push('score');
  if (
    rules.minAttendancePercent !== null &&
    (result.attendancePercent ?? 0) < rules.minAttendancePercent
  ) {
    reasons.push('attendancePercent');
  }
  return reasons.length === 0 ? { kind: 'passed' } : { kind: 'failed', reasons };
}
