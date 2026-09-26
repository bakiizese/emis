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
  'students.read': 'See student records, guardians and contact details',
  'students.manage': 'Register students and edit their records and guardians',
  'admissions.read': 'See applications and where they are in the admissions pipeline',
  'admissions.manage': 'Register applicants, edit applications and move them through the pipeline',
  'placement.record': 'Record placement results and recommend a starting level',
  'cohorts.read': 'See cohorts, their timetables and rosters',
  'cohorts.manage':
    'Create and schedule cohorts, assign rooms and instructors, open and close them',
  'enrollments.read': 'See who is enrolled or waitlisted in which cohort',
  'enrollments.manage': 'Enroll students, manage waitlists and record withdrawals',
  'results.record': 'Record final results and decide completion',
  'fees.read': 'See fee structures and payment plans',
  'fees.manage': 'Create fee structures and payment plans',
  'billing.read': 'See invoices, payments and receipts',
  'billing.invoice': 'Create invoices for enrollments',
  'billing.receive': 'Record payments and issue receipts',
  'billing.request': 'Ask for a discount or for a payment to be voided (a second person approves)',
  'approvals.decide': 'Approve or reject discount and void requests made by someone else',
  'certificates.read': 'See and print certificates',
  'certificates.issue': 'Issue certificates to students who completed a course',
  'certificates.revoke': 'Revoke a certificate so it no longer verifies',
  'posts.read': 'See news and announcements, including drafts',
  'posts.manage': 'Write and edit drafts of news and announcements',
  'posts.publish': 'Publish, schedule, unpublish and delete news, and edit what is already live',
  'reports.finance': 'See revenue and outstanding-balance reports and export them as CSV',
} as const satisfies Record<string, string>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}
