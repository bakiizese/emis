import { myAccessResponseSchema, problemDetailsSchema } from '@emis/contracts';
import {
  ALL_PERMISSIONS,
  type Permission,
  SYSTEM_ROLE_KEYS,
  SYSTEM_ROLES,
  type SystemRoleKey,
} from '@emis/permissions';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createTestApp } from '../../testing/create-test-app.js';
import { callAs, createStaff, type StaffFixture } from '../../testing/staff-fixtures.js';

// Syntactically valid UUIDv7s that don't exist: allowed callers get 404/400, denied ones 403.
const MISSING_ID = '0199a1b2-0000-7000-8000-000000000000';
const MISSING_ID_2 = '0199a1b2-0000-7000-8000-000000000001';

/** One representative request per protected endpoint, and the permission it needs. */
const ENDPOINTS: {
  permission: Permission;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  payload?: object;
}[] = [
  { permission: 'users.read', method: 'GET', url: '/users' },
  { permission: 'users.read', method: 'GET', url: `/users/${MISSING_ID}` },
  { permission: 'users.read', method: 'GET', url: '/roles' },
  { permission: 'users.invite', method: 'POST', url: '/users/invitations', payload: {} },
  { permission: 'users.manage', method: 'POST', url: `/users/${MISSING_ID}/invitation` },
  {
    permission: 'users.manage',
    method: 'PATCH',
    url: `/users/${MISSING_ID}/status`,
    payload: { status: 'disabled' },
  },
  { permission: 'roles.assign', method: 'POST', url: `/users/${MISSING_ID}/roles`, payload: {} },
  {
    permission: 'roles.assign',
    method: 'DELETE',
    url: `/users/${MISSING_ID}/roles/${MISSING_ID_2}`,
  },
  { permission: 'audit.read', method: 'GET', url: '/audit-log' },
  { permission: 'audit.read', method: 'GET', url: '/audit-log/verify' },
  { permission: 'settings.read', method: 'GET', url: '/institution' },
  { permission: 'settings.read', method: 'GET', url: '/branches' },
  { permission: 'settings.read', method: 'GET', url: '/departments' },
  { permission: 'settings.read', method: 'GET', url: '/modules' },
  { permission: 'settings.read', method: 'GET', url: '/descriptors?namespace=lead_source' },
  { permission: 'settings.read', method: 'GET', url: '/custom-fields?entityType=student' },
  { permission: 'settings.read', method: 'GET', url: '/terminology' },
  { permission: 'settings.read', method: 'GET', url: '/number-series' },
  // Allowed callers get 400/404/428 here: nothing is changed by these probes.
  { permission: 'settings.manage', method: 'PATCH', url: '/institution', payload: {} },
  { permission: 'settings.manage', method: 'POST', url: '/branches', payload: {} },
  { permission: 'settings.manage', method: 'PATCH', url: `/branches/${MISSING_ID}`, payload: {} },
  { permission: 'settings.manage', method: 'POST', url: '/departments', payload: {} },
  {
    permission: 'settings.manage',
    method: 'PATCH',
    url: `/departments/${MISSING_ID}`,
    payload: {},
  },
  {
    permission: 'settings.manage',
    method: 'PUT',
    url: '/modules/not_a_module',
    payload: { enabled: true },
  },
  { permission: 'settings.manage', method: 'POST', url: '/descriptors', payload: {} },
  {
    permission: 'settings.manage',
    method: 'PATCH',
    url: `/descriptors/${MISSING_ID}`,
    payload: {},
  },
  { permission: 'settings.manage', method: 'POST', url: '/custom-fields', payload: {} },
  {
    permission: 'settings.manage',
    method: 'PATCH',
    url: `/custom-fields/${MISSING_ID}`,
    payload: {},
  },
  { permission: 'settings.manage', method: 'PUT', url: '/terminology', payload: {} },
  {
    permission: 'settings.manage',
    method: 'PUT',
    url: '/number-series/not_a_series',
    payload: { pattern: 'X-{SEQ:4}' },
  },
  { permission: 'settings.manage', method: 'GET', url: '/setup' },
  { permission: 'settings.manage', method: 'POST', url: '/setup', payload: {} },
  { permission: 'catalog.read', method: 'GET', url: '/programs' },
  { permission: 'catalog.read', method: 'GET', url: `/programs/${MISSING_ID}` },
  { permission: 'catalog.read', method: 'GET', url: `/courses?programId=${MISSING_ID}` },
  { permission: 'catalog.read', method: 'GET', url: `/courses/${MISSING_ID}` },
  { permission: 'catalog.read', method: 'GET', url: '/academic-years' },
  { permission: 'catalog.read', method: 'GET', url: '/intakes' },
  { permission: 'catalog.read', method: 'GET', url: '/holidays' },
  { permission: 'catalog.read', method: 'GET', url: '/shifts' },
  { permission: 'catalog.read', method: 'GET', url: '/rooms' },
  { permission: 'catalog.manage', method: 'POST', url: '/programs', payload: {} },
  { permission: 'catalog.manage', method: 'PATCH', url: `/programs/${MISSING_ID}`, payload: {} },
  { permission: 'catalog.manage', method: 'POST', url: '/courses', payload: {} },
  { permission: 'catalog.manage', method: 'PATCH', url: `/courses/${MISSING_ID}`, payload: {} },
  {
    permission: 'catalog.manage',
    method: 'PUT',
    url: `/courses/${MISSING_ID}/prerequisites`,
    payload: { courseIds: [] },
  },
  { permission: 'calendar.manage', method: 'POST', url: '/academic-years', payload: {} },
  {
    permission: 'calendar.manage',
    method: 'PATCH',
    url: `/academic-years/${MISSING_ID}`,
    payload: {},
  },
  { permission: 'calendar.manage', method: 'POST', url: '/intakes', payload: {} },
  { permission: 'calendar.manage', method: 'PATCH', url: `/intakes/${MISSING_ID}`, payload: {} },
  { permission: 'calendar.manage', method: 'POST', url: '/holidays', payload: {} },
  { permission: 'calendar.manage', method: 'PATCH', url: `/holidays/${MISSING_ID}`, payload: {} },
  { permission: 'calendar.manage', method: 'DELETE', url: `/holidays/${MISSING_ID}` },
  { permission: 'facilities.manage', method: 'POST', url: '/shifts', payload: {} },
  { permission: 'facilities.manage', method: 'PATCH', url: `/shifts/${MISSING_ID}`, payload: {} },
  { permission: 'facilities.manage', method: 'POST', url: '/rooms', payload: {} },
  { permission: 'facilities.manage', method: 'PATCH', url: `/rooms/${MISSING_ID}`, payload: {} },
];

let app: NestFastifyApplication;
const staff = {} as Record<SystemRoleKey | 'none', StaffFixture>;

beforeAll(async () => {
  app = await createTestApp({
    env: { DATABASE_URL: inject('database').appUrl, RATE_LIMIT_MAX: '10000' },
  });
  for (const role of SYSTEM_ROLE_KEYS) {
    staff[role] = await createStaff(app, { email: `matrix-${role}@lingua.test`, roleKey: role });
  }
  staff.none = await createStaff(app, { email: 'matrix-norole@lingua.test' });
});
afterAll(() => app.close());

describe('authorization matrix', () => {
  it('covers every permission in the catalog', () => {
    expect(new Set(ENDPOINTS.map((e) => e.permission))).toEqual(new Set(ALL_PERMISSIONS));
  });

  const cases = [...SYSTEM_ROLE_KEYS, 'none' as const].flatMap((role) =>
    ENDPOINTS.map((endpoint) => {
      const allowed =
        role !== 'none' &&
        (SYSTEM_ROLES[role].permissions as readonly Permission[]).includes(endpoint.permission);
      return { role, allowed, ...endpoint };
    }),
  );

  it.each(cases)(
    '$role → $method $url is $allowed',
    async ({ role, allowed, method, url, payload }) => {
      const res = await callAs(app, staff[role])(method, url, payload);
      if (allowed) {
        expect(res.statusCode).not.toBe(403);
        expect(res.statusCode).toBeLessThan(500);
      } else {
        expect(res.statusCode).toBe(403);
        expect(problemDetailsSchema.parse(res.json()).code).toBe('PERMISSION_DENIED');
      }
    },
  );

  it('rejects anonymous callers before any permission check', async () => {
    const res = await callAs(app, null)('GET', '/users');
    expect(res.statusCode).toBe(401);
  });

  it('tells each person what they can do', async () => {
    for (const role of SYSTEM_ROLE_KEYS) {
      const res = await callAs(app, staff[role])('GET', '/access/me');
      const access = myAccessResponseSchema.parse(res.json());
      expect(access.roles.map((r) => r.key)).toEqual([role]);
      expect(access.permissions).toEqual([...SYSTEM_ROLES[role].permissions].sort());
    }
  });
});
