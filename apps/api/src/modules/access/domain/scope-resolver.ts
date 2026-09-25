import type { Scope } from '@emis/permissions';

/** Checks that a branch/department scope points at something real before a role is granted there. */
export abstract class ScopeResolver {
  abstract exists(scope: Scope): Promise<boolean>;
}
