/** A query string from the filters that are actually set, in a stable order. */
export function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(name, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** How wide a bar is, as a whole percentage of the biggest row (at least 2 so a small one stays visible). */
export function barPercent(amount: number, max: number): number {
  if (max <= 0 || amount <= 0) return 0;
  return Math.max(2, Math.round((amount / max) * 100));
}
