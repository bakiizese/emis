import { describe, expect, it } from 'vitest';

import { ALL_PERMISSIONS, isPermission, PERMISSIONS } from './catalog.js';
import { type Grant, hasPermission, scopesFor } from './check.js';
import { SYSTEM_ROLES } from './roles.js';

const global: Grant = { permission: 'users.read', scope: { type: 'global' } };
const branchA: Grant = { permission: 'users.read', scope: { type: 'branch', id: 'branch-a' } };
const deptX: Grant = { permission: 'users.read', scope: { type: 'department', id: 'dept-x' } };

describe('hasPermission', () => {
  it('denies by default', () => {
    expect(hasPermission([], 'users.read')).toBe(false);
    expect(hasPermission([global], 'users.invite')).toBe(false);
  });

  it('lets a global grant reach everything', () => {
    expect(hasPermission([global], 'users.read', { branchId: 'anything' })).toBe(true);
  });

  it('keeps scoped grants inside their branch or department', () => {
    expect(hasPermission([branchA], 'users.read', { branchId: 'branch-a' })).toBe(true);
    expect(hasPermission([branchA], 'users.read', { branchId: 'branch-b' })).toBe(false);
    expect(hasPermission([deptX], 'users.read', { departmentId: 'dept-x' })).toBe(true);
    expect(hasPermission([deptX], 'users.read', { branchId: 'branch-a' })).toBe(false);
  });

  it('answers "anywhere?" when there is no target', () => {
    expect(hasPermission([branchA], 'users.read')).toBe(true);
  });
});

describe('scopesFor', () => {
  it('collects the reachable branches and departments', () => {
    expect(scopesFor([branchA, deptX], 'users.read')).toEqual({
      all: false,
      branchIds: ['branch-a'],
      departmentIds: ['dept-x'],
    });
    expect(scopesFor([global, branchA], 'users.read').all).toBe(true);
  });
});

describe('catalog and roles', () => {
  it('only grants permissions that exist', () => {
    for (const role of Object.values(SYSTEM_ROLES)) {
      for (const permission of role.permissions) expect(isPermission(permission)).toBe(true);
    }
  });

  it('gives Admin everything and requires MFA for it', () => {
    expect([...SYSTEM_ROLES.admin.permissions].sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(SYSTEM_ROLES.admin.mfaRequired).toBe(true);
  });

  it('describes every permission', () => {
    for (const description of Object.values(PERMISSIONS))
      expect(description.length).toBeGreaterThan(10);
  });
});
