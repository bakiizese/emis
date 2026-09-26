export type ReminderStage = 'due_in_3' | 'due_today' | 'overdue_3' | 'overdue_7';

/** A reminder goes out once `daysPastDue` reaches the threshold (negative = before the due date). */
export const REMINDER_STAGES: readonly { key: ReminderStage; threshold: number }[] = [
  { key: 'due_in_3', threshold: -3 },
  { key: 'due_today', threshold: 0 },
  { key: 'overdue_3', threshold: 3 },
  { key: 'overdue_7', threshold: 7 },
];

/**
 * How late a reminder may still go out. If the job didn't run on the day (an outage), the reminder
 * for that stage is sent when it next runs, but not weeks later, when a newer stage has taken over.
 */
export const GRACE_DAYS = 2;

/** The earliest and latest due dates worth looking at today, so the query stays small. */
export const LOOKAHEAD_DAYS = 3;
export const LOOKBACK_DAYS = 7 + GRACE_DAYS;

/** Whole days from `dueDate` to `today` ("YYYY-MM-DD"): negative before the due date. */
export function daysPastDue(today: string, dueDate: string): number {
  return Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * Which reminder, if any, an instalment should get today. Only the latest stage reached counts
 * (an overdue instalment isn't told it is "due in 3 days"), each stage is sent once, and a stage
 * that's too far in the past is left alone.
 */
export function stageToSend(
  daysPast: number,
  alreadySent: ReadonlySet<string>,
): ReminderStage | null {
  let current: (typeof REMINDER_STAGES)[number] | undefined;
  for (const stage of REMINDER_STAGES) if (daysPast >= stage.threshold) current = stage;
  if (!current || alreadySent.has(current.key)) return null;
  return daysPast - current.threshold > GRACE_DAYS ? null : current.key;
}
