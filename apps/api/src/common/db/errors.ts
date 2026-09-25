function pgCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

/** A Postgres unique_violation (23505), whether thrown directly or wrapped by Drizzle. */
export function isUniqueViolation(error: unknown): boolean {
  return pgCode(error) === '23505' || pgCode((error as { cause?: unknown }).cause) === '23505';
}

/** A Postgres exclusion_violation (23P01), e.g. two overlapping date ranges. */
export function isExclusionViolation(error: unknown): boolean {
  return pgCode(error) === '23P01' || pgCode((error as { cause?: unknown }).cause) === '23P01';
}
