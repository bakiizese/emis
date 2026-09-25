/**
 * `{ field: { from, to } }` for every key in `after` whose value differs from `before`, for the
 * `changes` of an audit entry. Compare only the fields the caller actually changed.
 */
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(after)) {
    if (to === undefined) continue;
    const from = before[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from: from ?? null, to };
  }
  return changes;
}
