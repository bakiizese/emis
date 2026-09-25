import type { Permission } from './catalog.js';
import type { Scope } from './scope.js';

/** One permission held at one scope (a role assignment expands into several grants). */
export interface Grant {
  permission: Permission;
  scope: Scope;
}

/** The record being acted on. Omit it to ask "does this person have the permission anywhere?". */
export interface Target {
  branchId?: string | null;
  departmentId?: string | null;
}

function scopeCovers(scope: Scope, target: Target | undefined): boolean {
  if (scope.type === 'global' || target === undefined) return true;
  if (scope.type === 'branch') return target.branchId === scope.id;
  return target.departmentId === scope.id;
}

export function hasPermission(
  grants: readonly Grant[],
  permission: Permission,
  target?: Target,
): boolean {
  return grants.some(
    (grant) => grant.permission === permission && scopeCovers(grant.scope, target),
  );
}

/**
 * Which branches/departments a permission reaches, for building SQL filters.
 * `all: true` means a global grant: no filter needed.
 */
export function scopesFor(
  grants: readonly Grant[],
  permission: Permission,
): { all: boolean; branchIds: string[]; departmentIds: string[] } {
  const matching = grants.filter((grant) => grant.permission === permission);
  return {
    all: matching.some((grant) => grant.scope.type === 'global'),
    branchIds: matching.flatMap((grant) => (grant.scope.type === 'branch' ? [grant.scope.id] : [])),
    departmentIds: matching.flatMap((grant) =>
      grant.scope.type === 'department' ? [grant.scope.id] : [],
    ),
  };
}
