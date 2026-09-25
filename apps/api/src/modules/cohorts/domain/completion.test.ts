import { describe, expect, it } from 'vitest';

import { evaluateCompletion } from './completion.js';

const rules = { minAttendancePercent: 80, minScore: 60 };

describe('evaluateCompletion', () => {
  it('passes when every rule is met, with the minimum counting', () => {
    expect(evaluateCompletion(rules, { score: 60, attendancePercent: 80 })).toEqual({
      kind: 'passed',
    });
    expect(evaluateCompletion(rules, { score: 95, attendancePercent: 100 })).toEqual({
      kind: 'passed',
    });
  });

  it('fails on the rule that was missed, naming it', () => {
    expect(evaluateCompletion(rules, { score: 59.9, attendancePercent: 90 })).toEqual({
      kind: 'failed',
      reasons: ['score'],
    });
    expect(evaluateCompletion(rules, { score: 50, attendancePercent: 70 })).toEqual({
      kind: 'failed',
      reasons: ['score', 'attendancePercent'],
    });
  });

  it('asks for a number a rule needs instead of failing without it', () => {
    expect(evaluateCompletion(rules, { score: null, attendancePercent: 90 })).toEqual({
      kind: 'incomplete',
      missing: ['score'],
    });
    expect(evaluateCompletion(rules, { score: null, attendancePercent: null })).toEqual({
      kind: 'incomplete',
      missing: ['score', 'attendancePercent'],
    });
  });

  it('ignores a rule the course does not have', () => {
    expect(
      evaluateCompletion(
        { minAttendancePercent: null, minScore: 50 },
        { score: 55, attendancePercent: null },
      ),
    ).toEqual({ kind: 'passed' });
    expect(
      evaluateCompletion(
        { minAttendancePercent: null, minScore: null },
        { score: null, attendancePercent: null },
      ),
    ).toEqual({ kind: 'passed' });
  });
});
