/**
 * Every permission in the system. Routes declare one; roles are lists of them.
 * Naming: `<area>.<action>`. Add new ones here as modules land, then grant them in roles.ts.
 */
export const PERMISSIONS = {
  'users.read': 'See staff accounts and their roles',
  'users.invite': 'Invite new staff members',
  'users.manage': 'Disable, enable and resend invitations to staff accounts',
  'roles.assign': 'Grant or remove roles',
  'audit.read': 'Read the audit log and verify its integrity',
  'settings.read': 'See institution settings: branches, departments, lists and terminology',
  'settings.manage': 'Change institution settings, modules, numbering and run the setup wizard',
  'catalog.read': 'See programs, courses, the academic calendar, shifts and rooms',
  'catalog.manage': 'Create and edit programs, courses, prerequisites and completion rules',
  'calendar.manage': 'Manage academic years, intakes and holidays',
  'facilities.manage': 'Manage shifts and rooms',
} as const satisfies Record<string, string>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}
