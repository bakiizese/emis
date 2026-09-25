/** course id → the course ids it requires. */
export type PrerequisiteGraph = ReadonlyMap<string, readonly string[]>;

/**
 * Whether giving `courseId` these `newPrerequisites` would create a loop: some prerequisite
 * (directly or through its own prerequisites) already requires `courseId`. `existing` is the graph
 * as it stands, and `courseId`'s own edges in it are ignored since they're being replaced.
 */
export function wouldCreateCycle(
  existing: PrerequisiteGraph,
  courseId: string,
  newPrerequisites: readonly string[],
): boolean {
  const seen = new Set<string>();
  const stack = [...newPrerequisites];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (current === courseId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(existing.get(current) ?? []));
  }
  return false;
}
