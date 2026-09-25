import type { Grant } from '@emis/permissions';
import { describe, expect, it } from 'vitest';

import { assertBranchAccess, assertScope, branchReach } from './scope.js';

const grant = (scope: Grant['scope']): Grant => ({ permission: 'students.read', scope });

describe('branchReach', () => {
  it('is everything for a global or department grant', () => {
    expect(branchReach([grant({ type: 'global' })], 'students.read')).toBe('all');
    expect(branchReach([grant({ type: 'department', id: 'd1' })], 'students.read')).toBe('all');
  });

  it('is the listed branches for branch grants, and nothing without one', () => {
    expect(
      branchReach(
        [grant({ type: 'branch', id: 'b1' }), grant({ type: 'branch', id: 'b2' })],
        'students.read',
      ),
    ).toEqual(['b1', 'b2']);
    expect(branchReach([], 'students.read')).toEqual([]);
    expect(branchReach([grant({ type: 'global' })], 'students.manage')).toEqual([]);
  });
});

describe('assertBranchAccess', () => {
  it('lets a branch grant reach its own branch only', () => {
    const grants = [grant({ type: 'branch', id: 'b1' })];
    expect(() => assertBranchAccess(grants, 'students.read', 'b1')).not.toThrow();
    expect(() => assertBranchAccess(grants, 'students.read', 'b2')).toThrow();
  });
});

describe('assertScope', () => {
  it('denies by default', () => {
    expect(() => assertScope([], 'students.read')).toThrow();
  });
});
