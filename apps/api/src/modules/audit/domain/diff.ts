/**
 * `{ field: { from, to } }` for every key in `after` whose value differs from `before`, for the
 * `changes` of an audit entry. Compare only the fields the caller actually changed.
 * Built with Object.fromEntries (own properties only), so a key like `__proto__` can't pollute.
 */
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  return Object.fromEntries(
    Object.entries(after).flatMap(([key, to]) => {
      if (to === undefined) return [];
      const from = Object.hasOwn(before, key) ? before[key] : undefined;
      return JSON.stringify(from) === JSON.stringify(to) ? [] : [[key, { from: from ?? null, to }]];
    }),
  );
}
