/**
 * Where a role applies. Global = the whole institution; branch/department = only records that
 * belong to that branch or department (e.g. a Secretary at one campus).
 */
export const SCOPE_TYPES = ['global', 'branch', 'department'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export type Scope =
  { type: 'global' } | { type: 'branch'; id: string } | { type: 'department'; id: string };

export const GLOBAL_SCOPE: Scope = { type: 'global' };
