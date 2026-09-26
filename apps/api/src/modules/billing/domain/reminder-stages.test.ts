import { describe, expect, it } from 'vitest';

import { daysPastDue, GRACE_DAYS, REMINDER_STAGES, stageToSend } from './reminder-stages.js';

const none = new Set<string>();

describe('daysPastDue', () => {
  it('counts whole days, negative before the due date', () => {
    expect(daysPastDue('2026-09-30', '2026-09-30')).toBe(0);
    expect(daysPastDue('2026-09-27', '2026-09-30')).toBe(-3);
    expect(daysPastDue('2026-10-07', '2026-09-30')).toBe(7);
    expect(daysPastDue('2027-01-02', '2026-12-30')).toBe(3);
  });
});

describe('stageToSend', () => {
  it('starts three days before the due date, and not earlier', () => {
    expect(stageToSend(-4, none)).toBeNull();
    expect(stageToSend(-3, none)).toBe('due_in_3');
  });

  it('walks through the stages as the date passes', () => {
    expect(stageToSend(0, none)).toBe('due_today');
    expect(stageToSend(3, none)).toBe('overdue_3');
    expect(stageToSend(7, none)).toBe('overdue_7');
  });

  it('never sends the same stage twice', () => {
    expect(stageToSend(-3, new Set(['due_in_3']))).toBeNull();
    expect(stageToSend(0, new Set(['due_in_3']))).toBe('due_today');
    expect(stageToSend(0, new Set(['due_in_3', 'due_today']))).toBeNull();
  });

  it('only ever sends the latest stage reached: no stale "due soon" once it is due', () => {
    expect(stageToSend(0, new Set())).toBe('due_today');
    // The job was down for days and never sent overdue-3: only that stage is sent, not the earlier ones.
    expect(stageToSend(4, none)).toBe('overdue_3');
    expect(stageToSend(4, new Set(['overdue_3']))).toBeNull();
  });

  it('catches up a missed run within the grace window, and not after it', () => {
    for (const stage of REMINDER_STAGES) {
      // A stage can be sent on its day and for GRACE_DAYS after, as long as no later stage has started.
      expect(stageToSend(stage.threshold, none)).toBe(stage.key);
    }
    // due_in_3 (day -3) still applies on days -2 and -1 if it was missed; day 0 is a new stage.
    expect(stageToSend(-2, none)).toBe('due_in_3');
    expect(stageToSend(-1, none)).toBe('due_in_3');
    // overdue_3 covers days 3-5; on day 6 it's too stale and overdue_7 hasn't begun.
    expect(stageToSend(3 + GRACE_DAYS, none)).toBe('overdue_3');
    expect(stageToSend(3 + GRACE_DAYS + 1, none)).toBeNull();
    // overdue_7 covers days 7-9.
    expect(stageToSend(7 + GRACE_DAYS, none)).toBe('overdue_7');
    expect(stageToSend(7 + GRACE_DAYS + 1, none)).toBeNull();
  });

  it('stops reminding long after the last stage', () => {
    expect(stageToSend(30, none)).toBeNull();
  });
});
