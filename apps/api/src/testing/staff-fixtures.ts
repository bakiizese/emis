import { roles, userRoleAssignments } from '@emis/db';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { ClsService } from 'nestjs-cls';

import type { DbAdapter } from '../database/database.module.js';
import { AccountsService, SessionsService } from '../modules/identity/index.js';

export const TEST_PASSWORD = 'lantern-orbit-velvet-cactus';
const COOKIE = '__Host-emis_session';

export interface StaffFixture {
  userId: string;
  email: string;
  cookie: string;
}

/** A signed-in staff member (MFA already satisfied) holding the given role globally. */
export async function createStaff(
  app: NestFastifyApplication,
  options: { email: string; roleKey?: string; displayName?: string },
): Promise<StaffFixture> {
  return app.get(ClsService).run(async () => {
    const { id } = await app.get(AccountsService).create({
      email: options.email,
      displayName: options.displayName ?? 'Test Staff',
      password: TEST_PASSWORD,
    });
    if (options.roleKey) {
      const db = app.get<TransactionHost<DbAdapter>>(TransactionHost).tx;
      const [role] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.key, options.roleKey));
      if (!role) throw new Error(`role ${options.roleKey} missing`);
      await db
        .insert(userRoleAssignments)
        .values({ userId: id, roleId: role.id, scopeType: 'global' });
    }
    const { token } = await app
      .get(SessionsService)
      .create(id, { ip: null, userAgent: null }, { mfaVerified: true });
    return { userId: id, email: options.email, cookie: `${COOKIE}=${token}` };
  });
}

export function callAs(app: NestFastifyApplication, who: { cookie: string } | null) {
  return (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ): Promise<LightMyRequestResponse> =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: who ? { cookie: who.cookie } : {},
      ...(payload ? { payload } : {}),
    });
}
