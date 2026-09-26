/** Seats filled as a whole percentage of seats available (0 when there are none). */
export function occupancyPercent(enrolled: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return Math.min(100, Math.round((enrolled / capacity) * 100));
}

/** How this month compares with last, in words: "up 20% on last month". */
export function monthComparison(thisMonth: number, lastMonth: number): string {
  if (lastMonth === 0)
    return thisMonth > 0 ? 'nothing collected last month' : 'nothing collected yet';
  const change = Math.round(((thisMonth - lastMonth) / lastMonth) * 100);
  if (change === 0) return 'same as last month';
  return `${change > 0 ? 'up' : 'down'} ${Math.abs(change)}% on last month`;
}

/** "Starts tomorrow", "Starts in 5 days" from whole days until the start. */
export function startsIn(days: number): string {
  if (days <= 0) return 'Starts today';
  if (days === 1) return 'Starts tomorrow';
  return `Starts in ${days} days`;
}

export function daysUntil(date: string, today: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}
