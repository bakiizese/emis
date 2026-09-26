import { ALL_PERMISSIONS, type Permission } from './catalog.js';
import type { ScopeType } from './scope.js';

export interface SystemRoleDefinition {
  name: string;
  description: string;
  permissions: readonly Permission[];
  /** Scopes this role can be granted at. */
  allowedScopes: readonly ScopeType[];
  /** Anyone holding the role must use two-factor authentication. */
  mfaRequired: boolean;
}

/**
 * The four roles every install starts with. Permissions are synced into the database at startup,
 * so adding a permission here reaches every install on upgrade. Institutions can add custom roles.
 */
export const SYSTEM_ROLES = {
  admin: {
    name: 'Admin',
    description: 'Owner or manager. Full access, including settings, finance and staff accounts.',
    permissions: ALL_PERMISSIONS,
    allowedScopes: ['global'],
    mfaRequired: true,
  },
  coordinator: {
    name: 'Coordinator',
    description: 'Runs the academic side of one or more departments.',
    permissions: [
      'users.read',
      'settings.read',
      'catalog.read',
      'catalog.manage',
      'students.read',
      'admissions.read',
      'placement.record',
      'cohorts.read',
      'cohorts.manage',
      'enrollments.read',
      'results.record',
      'fees.read',
      'certificates.read',
      'certificates.issue',
      'posts.read',
      'posts.manage',
    ],
    allowedScopes: ['global', 'department'],
    mfaRequired: false,
  },
  secretary: {
    name: 'Secretary',
    description: 'Front desk: registrations, student records and payments at a branch.',
    permissions: [
      'settings.read',
      'catalog.read',
      'students.read',
      'students.manage',
      'admissions.read',
      'admissions.manage',
      'placement.record',
      'cohorts.read',
      'enrollments.read',
      'enrollments.manage',
      'fees.read',
      'billing.read',
      'billing.invoice',
      'billing.receive',
      'billing.request',
      'certificates.read',
      'posts.read',
    ],
    allowedScopes: ['global', 'branch'],
    mfaRequired: false,
  },
  instructor: {
    name: 'Instructor',
    description: 'Teaches cohorts: class lists, attendance and results for their own classes.',
    permissions: ['settings.read', 'catalog.read'],
    allowedScopes: ['global'],
    mfaRequired: false,
  },
} as const satisfies Record<string, SystemRoleDefinition>;

export type SystemRoleKey = keyof typeof SYSTEM_ROLES;

export const SYSTEM_ROLE_KEYS = Object.keys(SYSTEM_ROLES) as SystemRoleKey[];

export function isSystemRoleKey(value: string): value is SystemRoleKey {
  return Object.hasOwn(SYSTEM_ROLES, value);
}
