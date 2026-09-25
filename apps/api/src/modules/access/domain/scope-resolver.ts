import type { Scope } from '@emis/permissions';

/**
 * Checks that a branch/department scope points at something real. The institution-config module
 * provides the real implementation once branches and departments exist; until then only the
 * global scope can be granted.
 */
export abstract class ScopeResolver {
  abstract exists(scope: Scope): Promise<boolean>;
}

export class GlobalOnlyScopeResolver extends ScopeResolver {
  exists(scope: Scope): Promise<boolean> {
    return Promise.resolve(scope.type === 'global');
  }
}
