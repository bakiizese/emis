import {
  auditListResponseSchema,
  auditVerifyResponseSchema,
  problemDetailsSchema,
  staffListResponseSchema,
  staffUserSchema,
} from '@emis/contracts';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import { ClsService } from 'nestjs-cls';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createIsolatedDatabase, type TestDatabaseUrls } from '@emis/db/testing';

import type { DbAdapter } from '../../database/database.module.js';
import type { CapturingMailer } from '../../testing/capturing-mailer.js';
import { createTestAppWithMailer } from '../../testing/create-test-app.js';
import {
  callAs,
  createStaff,
  type StaffFixture,
  TEST_PASSWORD,
} from '../../testing/staff-fixtures.js';
import { AuditService } from '../audit/index.js';

// Own database: "last admin" checks need to know every admin, so no other test file may add one here.
let urls: TestDatabaseUrls;
const STRONG = 'marble-kettle-horizon-plume';

let app: NestFastifyApplication;
let mailer: CapturingMailer;
let admin: StaffFixture;
let asAdmin: ReturnType<typeof callAs>;

const code = (res: LightMyRequestResponse) => problemDetailsSchema.parse(res.json()).code;

function tokenFromEmail(to: string): string {
  const match = mailer.lastTo(to)?.text.match(/\/accept-invite#token=([\w-]+)/);
  if (!match?.[1]) throw new Error(`no invitation email for ${to}`);
  return match[1];
}

async function invite(email: string, roleKey = 'secretary', scope?: object) {
  return asAdmin('POST', '/users/invitations', {
    email,
    displayName: 'New Person',
    roleKey,
    ...(scope ? { scope } : {}),
  });
}

async function login(email: string, password: string) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
}

beforeAll(async () => {
  urls = await createIsolatedDatabase(inject('database'), 'emis_staff_test');
  ({ app, mailer } = await createTestAppWithMailer({
    env: { DATABASE_URL: urls.appUrl, RATE_LIMIT_MAX: '10000' },
  }));
  admin = await createStaff(app, {
    email: 'staff-owner@lingua.test',
    roleKey: 'admin',
    displayName: 'Owner',
  });
  asAdmin = callAs(app, admin);
});
afterAll(() => app.close());

describe('inviting staff', () => {
  it('creates the account, emails a single-use link, and activates on accept', async () => {
    const res = await invite('hana@lingua.test');
    expect(res.statusCode).toBe(201);
    const invited = staffUserSchema.parse(res.json());
    expect(invited).toMatchObject({
      status: 'invited',
      roles: [{ roleKey: 'secretary', scope: { type: 'global' } }],
    });

    const token = tokenFromEmail('hana@lingua.test');
    expect(mailer.lastTo('hana@lingua.test')?.text).toContain('Owner invited you');

    const details = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations/inspect',
      payload: { token },
    });
    expect(details.json()).toMatchObject({ email: 'hana@lingua.test', displayName: 'New Person' });

    const weak = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations/accept',
      payload: { token, password: 'password12345' },
    });
    expect(code(weak)).toBe('WEAK_PASSWORD');

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations/accept',
      payload: { token, password: STRONG },
    });
    expect(ok.statusCode).toBe(204);
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations/accept',
      payload: { token, password: STRONG },
    });
    expect(code(again)).toBe('INVALID_INVITATION');

    expect((await login('hana@lingua.test', STRONG)).json()).toMatchObject({ nextStep: 'none' });
    expect(
      staffUserSchema.parse((await asAdmin('GET', `/users/${invited.id}`)).json()).status,
    ).toBe('active');
  });

  it('requires two-factor authentication for invited admins', async () => {
    const res = await invite('second-admin@lingua.test', 'admin');
    expect(staffUserSchema.parse(res.json()).mfaEnforced).toBe(true);
  });

  it('rejects bad invitations', async () => {
    expect(code(await invite('staff-owner@lingua.test'))).toBe('EMAIL_TAKEN');
    expect(code(await invite('x@lingua.test', 'wizard'))).toBe('ROLE_NOT_FOUND');
    expect(
      code(
        await invite('y@lingua.test', 'admin', {
          type: 'department',
          id: '0199a1b2-0000-7000-8000-000000000009',
        }),
      ),
    ).toBe('SCOPE_NOT_ALLOWED');
    expect(
      code(
        await invite('z@lingua.test', 'secretary', {
          type: 'branch',
          id: '0199a1b2-0000-7000-8000-000000000009',
        }),
      ),
    ).toBe('SCOPE_NOT_AVAILABLE');
  });

  it('resends a fresh link and kills the old one', async () => {
    const invited = staffUserSchema.parse((await invite('resend@lingua.test')).json());
    const first = tokenFromEmail('resend@lingua.test');
    expect((await asAdmin('POST', `/users/${invited.id}/invitation`)).statusCode).toBe(202);
    const second = tokenFromEmail('resend@lingua.test');
    expect(second).not.toBe(first);

    const old = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations/inspect',
      payload: { token: first },
    });
    expect(code(old)).toBe('INVALID_INVITATION');
    const fresh = await app.inject({
      method: 'POST',
      url: '/api/v1/invitations/inspect',
      payload: { token: second },
    });
    expect(fresh.statusCode).toBe(200);

    const active = await createStaff(app, {
      email: 'already-active@lingua.test',
      roleKey: 'instructor',
    });
    expect(code(await asAdmin('POST', `/users/${active.userId}/invitation`))).toBe(
      'ALREADY_ACTIVATED',
    );
  });
});

describe('managing staff', () => {
  it('disabling signs them out everywhere and blocks sign-in until re-enabled', async () => {
    const secretary = await createStaff(app, { email: 'desk@lingua.test', roleKey: 'secretary' });
    expect((await callAs(app, secretary)('GET', '/access/me')).statusCode).toBe(200);

    const disabled = await asAdmin('PATCH', `/users/${secretary.userId}/status`, {
      status: 'disabled',
    });
    expect(staffUserSchema.parse(disabled.json()).status).toBe('disabled');
    expect((await callAs(app, secretary)('GET', '/access/me')).statusCode).toBe(401);
    expect((await login('desk@lingua.test', TEST_PASSWORD)).statusCode).toBe(401);

    await asAdmin('PATCH', `/users/${secretary.userId}/status`, { status: 'active' });
    expect((await login('desk@lingua.test', TEST_PASSWORD)).statusCode).toBe(200);
  });

  it("won't let you disable yourself", async () => {
    expect(
      code(await asAdmin('PATCH', `/users/${admin.userId}/status`, { status: 'disabled' })),
    ).toBe('CANNOT_CHANGE_SELF');
  });

  it('always keeps one active admin', async () => {
    const me = staffUserSchema.parse((await asAdmin('GET', `/users/${admin.userId}`)).json());
    const adminRole = me.roles.find((r) => r.roleKey === 'admin');
    if (!adminRole) throw new Error('fixture admin has no admin role');

    // The invited admin from earlier has no password yet, so it doesn't count.
    expect(code(await asAdmin('DELETE', `/users/${admin.userId}/roles/${adminRole.id}`))).toBe(
      'LAST_ADMIN',
    );

    const backup = await createStaff(app, { email: 'backup-admin@lingua.test', roleKey: 'admin' });
    const removed = await asAdmin('DELETE', `/users/${admin.userId}/roles/${adminRole.id}`);
    expect(staffUserSchema.parse(removed.json()).roles.some((r) => r.roleKey === 'admin')).toBe(
      false,
    );

    // Put things back for the rest of the file (the backup admin grants it).
    await callAs(app, backup)('POST', `/users/${admin.userId}/roles`, { roleKey: 'admin' });
  });

  it('grants roles once', async () => {
    const person = await createStaff(app, { email: 'grow@lingua.test', roleKey: 'secretary' });
    const granted = await asAdmin('POST', `/users/${person.userId}/roles`, {
      roleKey: 'coordinator',
    });
    expect(
      staffUserSchema
        .parse(granted.json())
        .roles.map((r) => r.roleKey)
        .sort(),
    ).toEqual(['coordinator', 'secretary']);
    expect(
      code(await asAdmin('POST', `/users/${person.userId}/roles`, { roleKey: 'coordinator' })),
    ).toBe('ROLE_ALREADY_ASSIGNED');
  });

  it('lists and searches staff with cursor pagination', async () => {
    const first = staffListResponseSchema.parse((await asAdmin('GET', '/users?limit=2')).json());
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = staffListResponseSchema.parse(
      (await asAdmin('GET', `/users?limit=2&cursor=${first.nextCursor}`)).json(),
    );
    expect(second.items.map((u) => u.id)).not.toContain(first.items[0]?.id);

    const search = staffListResponseSchema.parse((await asAdmin('GET', '/users?q=hana')).json());
    expect(search.items.map((u) => u.email)).toEqual(['hana@lingua.test']);
    // LIKE wildcards in the search are treated as text, not patterns.
    expect(
      staffListResponseSchema.parse((await asAdmin('GET', '/users?q=%25')).json()).items,
    ).toHaveLength(0);
  });
});

describe('audit trail', () => {
  it('records who did what, including the invitee accepting', async () => {
    const log = auditListResponseSchema.parse(
      (await asAdmin('GET', '/audit-log?limit=100')).json(),
    );
    const actions = log.items.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'user.invited',
        'user.invitation_accepted',
        'user.disabled',
        'user.enabled',
        'role.assigned',
        'role.removed',
        'user.invitation_resent',
      ]),
    );

    const invited = log.items.find((e) => e.action === 'user.invited');
    expect(invited).toMatchObject({ actorEmail: 'staff-owner@lingua.test', entityType: 'user' });
    expect(invited?.requestId).toBeTruthy();
    const accepted = log.items.find((e) => e.action === 'user.invitation_accepted');
    expect(accepted?.actorEmail).toBe('hana@lingua.test');
  });

  it('writes nothing when the surrounding transaction rolls back', async () => {
    const txHost = app.get<TransactionHost<DbAdapter>>(TransactionHost);
    await expect(
      app.get(ClsService).run(() =>
        txHost.withTransaction(async () => {
          await app.get(AuditService).record({ action: 'test.rolled_back', entityType: 'test' });
          throw new Error('abort');
        }),
      ),
    ).rejects.toThrow('abort');

    const log = auditListResponseSchema.parse(
      (await asAdmin('GET', '/audit-log?action=test.rolled_back')).json(),
    );
    expect(log.items).toHaveLength(0);
  });

  it('verifies the chain, and pinpoints a tampered row', async () => {
    const intact = auditVerifyResponseSchema.parse(
      (await asAdmin('GET', '/audit-log/verify')).json(),
    );
    expect(intact).toMatchObject({ intact: true, brokenAtSeq: null });
    expect(intact.checked).toBeGreaterThan(5);

    // Someone with direct database access quietly edits history.
    const superuser = new pg.Client({ connectionString: urls.adminUrl });
    await superuser.connect();
    const { rows } = await superuser.query<{ seq: string }>(
      'UPDATE audit_log SET changes = \'{"status":"nothing to see"}\' WHERE action = \'user.disabled\' RETURNING seq',
    );
    await superuser.end();

    const broken = auditVerifyResponseSchema.parse(
      (await asAdmin('GET', '/audit-log/verify')).json(),
    );
    expect(broken.intact).toBe(false);
    expect(broken.brokenAtSeq).toBe(Number(rows[0]?.seq));
  });
});
