import { ACCESS_ERROR_CODES } from '@emis/contracts';
import {
  type Grant,
  hasPermission,
  type Permission,
  scopesFor,
  type Target,
} from '@emis/permissions';
import { ForbiddenException } from '@nestjs/common';

/**
 * Record-level authorization on top of the route-level check: the route guard only checks that the
 * caller holds `permission` *somewhere*; this checks they hold it at `target`'s branch/department
 * (or globally). Call it in the service, after loading the record whose scope you're checking.
 */
export function assertScope(
  grants: readonly Grant[],
  permission: Permission,
  target?: Target,
): void {
  if (!hasPermission(grants, permission, target)) {
    throw new ForbiddenException({
      code: ACCESS_ERROR_CODES.permissionDenied,
      message: "You don't have permission to do that.",
    });
  }
}

/**
 * Which branches a permission lets the caller see, for filtering lists: `'all'`, or the branch ids
 * they're limited to. A department-scoped grant isn't tied to any branch (students only get a
 * department through their enrollments, which come later), so it reaches every branch.
 */
export function branchReach(grants: readonly Grant[], permission: Permission): 'all' | string[] {
  const reach = scopesFor(grants, permission);
  if (reach.all || reach.departmentIds.length > 0) return 'all';
  return reach.branchIds;
}

/** 403 unless `branchReach` covers this branch. For reading one record at a known branch. */
export function assertBranchAccess(
  grants: readonly Grant[],
  permission: Permission,
  branchId: string,
): void {
  const reach = branchReach(grants, permission);
  if (reach !== 'all' && !reach.includes(branchId)) assertScope([], permission);
}
