import {
  loginResponseSchema,
  meResponseSchema,
  problemDetailsSchema,
  recoveryCodesResponseSchema,
  totpSetupResponseSchema,
} from '@emis/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import { ClsService } from 'nestjs-cls';
import { generate } from 'otplib';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createTestAppWithMailer, type TestApp } from '../../testing/create-test-app.js';
import { AccountsService } from './index.js';

const PASSWORD = 'lantern-orbit-velvet-cactus';
const COOKIE = '__Host-emis_session';
const urls = inject('database');

let app: NestFastifyApplication;
let mail: TestApp['mail'];
let db: pg.Client;
let ipCounter = 10;

/** Each test gets its own client IP so per-IP rate limits don't leak between tests. */
function newClient() {
  const ip = `10.0.0.${ipCounter++}`;
  let cookie: string | undefined;

  async function call(
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    payload?: object,
    headers: Record<string, string> = {},
  ) {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      remoteAddress: ip,
      headers: { ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}), ...headers },
      ...(payload ? { payload } : {}),
    });
    const set = res.cookies.find((c) => c.name === COOKIE);
    if (set) cookie = set.value === '' ? undefined : set.value;
    return res;
  }
  return {
    call,
    get token() {
      return cookie;
    },
    set token(value: string | undefined) {
      cookie = value;
    },
  };
}

async function createUser(
  email: string,
  options: { mfaEnforced?: boolean; password?: string } = {},
) {
  const cls = app.get(ClsService);
  return cls.run(() =>
    app.get(AccountsService).create({
      email,
      displayName: 'Test Person',
      password: options.password ?? PASSWORD,
      mfaEnforced: options.mfaEnforced ?? false,
    }),
  );
}

function problemCode(res: LightMyRequestResponse): string {
  return problemDetailsSchema.parse(res.json()).code;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

beforeAll(async () => {
  ({ app, mail } = await createTestAppWithMailer({ env: { DATABASE_URL: urls.appUrl } }));
  db = new pg.Client({ connectionString: urls.appUrl });
  await db.connect();
});

afterAll(async () => {
  await db.end();
  await app.close();
});

describe('sign in and out', () => {
  it('sets a hardened session cookie, serves /me, and signs out', async () => {
    await createUser('plain@lingua.test');
    const client = newClient();

    const login = await client.call('POST', '/auth/login', {
      email: 'Plain@Lingua.test',
      password: PASSWORD,
    });
    expect(login.statusCode).toBe(200);
    expect(loginResponseSchema.parse(login.json()).nextStep).toBe('none');

    const cookie = login.cookies.find((c) => c.name === COOKIE);
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    expect(cookie?.maxAge).toBeUndefined();

    const me = await client.call('GET', '/auth/me');
    expect(meResponseSchema.parse(me.json()).user.email).toBe('plain@lingua.test');

    const stolen = client.token;
    expect((await client.call('POST', '/auth/logout')).statusCode).toBe(204);

    client.token = stolen; // replaying the old cookie must not work
    expect(problemCode(await client.call('GET', '/auth/me'))).toBe('UNAUTHENTICATED');
  });

  it('answers wrong passwords and unknown emails identically', async () => {
    await createUser('twin@lingua.test');
    const client = newClient();

    const wrong = await client.call('POST', '/auth/login', {
      email: 'twin@lingua.test',
      password: 'not-the-password',
    });
    const unknown = await client.call('POST', '/auth/login', {
      email: 'ghost@lingua.test',
      password: 'whatever-password',
    });

    for (const res of [wrong, unknown]) {
      expect(res.statusCode).toBe(401);
      expect(problemDetailsSchema.parse(res.json())).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        detail: 'Incorrect email or password.',
      });
    }
  });

  it('requires a session everywhere except public routes', async () => {
    const client = newClient();
    expect(problemCode(await client.call('GET', '/auth/sessions'))).toBe('UNAUTHENTICATED');

    client.token = 'forged-token-value-that-does-not-exist';
    const res = await client.call('GET', '/auth/sessions');
    expect(problemCode(res)).toBe('UNAUTHENTICATED');
    expect(res.cookies.find((c) => c.name === COOKIE)?.value).toBe('');
  });

  it('expires idle sessions', async () => {
    await createUser('idle@lingua.test');
    const client = newClient();
    await client.call('POST', '/auth/login', { email: 'idle@lingua.test', password: PASSWORD });

    await db.query(
      `UPDATE user_sessions SET idle_expires_at = now() - interval '1 second'
       WHERE user_id = (SELECT id FROM user_accounts WHERE email = 'idle@lingua.test')`,
    );
    expect(problemCode(await client.call('GET', '/auth/me'))).toBe('UNAUTHENTICATED');
  });

  it('rejects cross-site state changes', async () => {
    await createUser('csrf@lingua.test');
    const client = newClient();
    await client.call('POST', '/auth/login', { email: 'csrf@lingua.test', password: PASSWORD });

    const attack = await client.call('POST', '/auth/logout', undefined, {
      origin: 'https://evil.example',
    });
    expect(attack.statusCode).toBe(403);
    expect(problemCode(attack)).toBe('CSRF_REJECTED');

    const fromPortal = await client.call('POST', '/auth/logout', undefined, {
      origin: 'https://portal.test',
    });
    expect(fromPortal.statusCode).toBe(204);
  });

  it('rate-limits sign-in attempts per client', async () => {
    const client = newClient();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await client.call('POST', '/auth/login', {
        email: 'ghost@lingua.test',
        password: 'wrong-password',
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('lockout', () => {
  it('locks after 5 failures, blocks even the right password, and emails the owner', async () => {
    await createUser('locked@lingua.test');
    const client = newClient();

    for (let i = 0; i < 5; i++) {
      await client.call('POST', '/auth/login', {
        email: 'locked@lingua.test',
        password: 'wrong-password',
      });
    }
    const correct = await client.call('POST', '/auth/login', {
      email: 'locked@lingua.test',
      password: PASSWORD,
    });
    expect(problemCode(correct)).toBe('INVALID_CREDENTIALS');
    expect((await mail.lastTo('locked@lingua.test'))?.subject).toMatch(/locked/);

    const { rows } = await db.query<{ type: string }>(
      `SELECT type FROM security_events
       WHERE user_id = (SELECT id FROM user_accounts WHERE email = 'locked@lingua.test') ORDER BY occurred_at`,
    );
    expect(rows.map((r) => r.type)).toEqual([
      ...Array.from({ length: 5 }, () => 'login.failed'),
      'account.locked',
      'login.blocked',
    ]);

    await db.query(
      `UPDATE user_accounts SET locked_until = now() - interval '1 second' WHERE email = 'locked@lingua.test'`,
    );
    const afterLock = await client.call('POST', '/auth/login', {
      email: 'locked@lingua.test',
      password: PASSWORD,
    });
    expect(afterLock.statusCode).toBe(200);
  });
});

describe('two-factor authentication', () => {
  it('forces enrollment for enforced accounts, then asks for a code at every sign-in', async () => {
    await createUser('admin@lingua.test', { mfaEnforced: true });
    const client = newClient();

    const login = await client.call('POST', '/auth/login', {
      email: 'admin@lingua.test',
      password: PASSWORD,
    });
    expect(login.json()).toMatchObject({ nextStep: 'mfa_enrollment' });
    expect(problemCode(await client.call('GET', '/auth/sessions'))).toBe('MFA_ENROLLMENT_REQUIRED');

    const setup = totpSetupResponseSchema.parse(
      (await client.call('POST', '/auth/mfa/totp/setup')).json(),
    );
    expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.qrCodeSvg).toMatch(/^<svg/);

    const { rows } = await db.query<{ secret_ciphertext: string }>(
      `SELECT secret_ciphertext FROM user_totp_factors
       WHERE user_id = (SELECT id FROM user_accounts WHERE email = 'admin@lingua.test')`,
    );
    expect(rows[0]?.secret_ciphertext).toMatch(/^v1\./);
    expect(rows[0]?.secret_ciphertext).not.toContain(setup.secret);

    const beforeRotation = client.token;
    const code = await generate({ secret: setup.secret });
    const confirmed = await client.call('POST', '/auth/mfa/totp/confirm', { code });
    const { recoveryCodes } = recoveryCodesResponseSchema.parse(confirmed.json());
    expect(recoveryCodes).toHaveLength(10);
    expect(client.token).not.toBe(beforeRotation); // session token rotated after MFA
    expect((await client.call('GET', '/auth/sessions')).statusCode).toBe(200);

    // Next sign-in: second factor required, and the same code can't be replayed.
    const second = newClient();
    const again = await second.call('POST', '/auth/login', {
      email: 'admin@lingua.test',
      password: PASSWORD,
    });
    expect(again.json()).toMatchObject({ nextStep: 'mfa' });
    expect(problemCode(await second.call('GET', '/auth/sessions'))).toBe('MFA_REQUIRED');
    expect(problemCode(await second.call('POST', '/auth/mfa/verify', { code }))).toBe(
      'INVALID_MFA_CODE',
    );

    const nextCode = await generate({ secret: setup.secret, epoch: nowSeconds() + 30 });
    expect((await second.call('POST', '/auth/mfa/verify', { code: nextCode })).statusCode).toBe(
      204,
    );
    expect(
      meResponseSchema.parse((await second.call('GET', '/auth/me')).json()).session.mfaVerified,
    ).toBe(true);

    // A recovery code works exactly once.
    const third = newClient();
    await third.call('POST', '/auth/login', { email: 'admin@lingua.test', password: PASSWORD });
    const recovery = recoveryCodes[0]?.toLowerCase() ?? '';
    expect(
      (await third.call('POST', '/auth/mfa/verify', { recoveryCode: recovery })).statusCode,
    ).toBe(204);

    const fourth = newClient();
    await fourth.call('POST', '/auth/login', { email: 'admin@lingua.test', password: PASSWORD });
    expect(
      problemCode(await fourth.call('POST', '/auth/mfa/verify', { recoveryCode: recovery })),
    ).toBe('INVALID_MFA_CODE');

    // Enforced accounts can't switch MFA off.
    const off = await second.call('DELETE', '/auth/mfa/totp', {
      password: PASSWORD,
      code: nextCode,
    });
    expect(problemCode(off)).toBe('MFA_ENFORCED');
  });

  it('ends the pending session after 5 wrong codes', async () => {
    await createUser('guess@lingua.test', { mfaEnforced: true });
    const enroll = newClient();
    await enroll.call('POST', '/auth/login', { email: 'guess@lingua.test', password: PASSWORD });
    const { secret } = totpSetupResponseSchema.parse(
      (await enroll.call('POST', '/auth/mfa/totp/setup')).json(),
    );
    await enroll.call('POST', '/auth/mfa/totp/confirm', { code: await generate({ secret }) });

    const attacker = newClient();
    await attacker.call('POST', '/auth/login', { email: 'guess@lingua.test', password: PASSWORD });
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push(problemCode(await attacker.call('POST', '/auth/mfa/verify', { code: '000000' })));
    }
    expect(codes.slice(0, 4).every((c) => c === 'INVALID_MFA_CODE')).toBe(true);
    expect(codes[4]).toBe('UNAUTHENTICATED');
    expect(problemCode(await attacker.call('GET', '/auth/me'))).toBe('UNAUTHENTICATED');
  });
});

describe('passwords', () => {
  it('resets through the emailed link, once, and signs out everywhere', async () => {
    await createUser('forgot@lingua.test');
    const oldDevice = newClient();
    await oldDevice.call('POST', '/auth/login', {
      email: 'forgot@lingua.test',
      password: PASSWORD,
    });

    const client = newClient();
    expect(
      (await client.call('POST', '/auth/password/forgot', { email: 'nobody@lingua.test' }))
        .statusCode,
    ).toBe(202);
    expect(await mail.lastTo('nobody@lingua.test')).toBeUndefined();

    expect(
      (await client.call('POST', '/auth/password/forgot', { email: 'forgot@lingua.test' }))
        .statusCode,
    ).toBe(202);
    const link = (await mail.lastTo('forgot@lingua.test'))?.text.match(
      /https:\/\/portal\.test\/reset-password#token=([\w-]+)/,
    );
    const token = link?.[1] ?? '';
    expect(token.length).toBeGreaterThan(30);

    const weak = await client.call('POST', '/auth/password/reset', {
      token,
      password: 'password12345',
    });
    expect(problemCode(weak)).toBe('WEAK_PASSWORD');

    const newPassword = 'marble-kettle-horizon-plume';
    expect(
      (await client.call('POST', '/auth/password/reset', { token, password: newPassword }))
        .statusCode,
    ).toBe(204);
    expect(
      problemCode(
        await client.call('POST', '/auth/password/reset', { token, password: newPassword }),
      ),
    ).toBe('INVALID_RESET_TOKEN');

    expect(problemCode(await oldDevice.call('GET', '/auth/me'))).toBe('UNAUTHENTICATED');
    const login = await client.call('POST', '/auth/login', {
      email: 'forgot@lingua.test',
      password: newPassword,
    });
    expect(login.statusCode).toBe(200);
  });

  it('changes the password and signs out other devices only', async () => {
    await createUser('change@lingua.test');
    const laptop = newClient();
    const phone = newClient();
    await laptop.call('POST', '/auth/login', { email: 'change@lingua.test', password: PASSWORD });
    await phone.call('POST', '/auth/login', { email: 'change@lingua.test', password: PASSWORD });

    const wrong = await laptop.call('POST', '/auth/password/change', {
      currentPassword: 'not-my-password',
      newPassword: 'marble-kettle-horizon-plume',
    });
    expect(problemCode(wrong)).toBe('INVALID_CURRENT_PASSWORD');

    const ok = await laptop.call('POST', '/auth/password/change', {
      currentPassword: PASSWORD,
      newPassword: 'marble-kettle-horizon-plume',
    });
    expect(ok.statusCode).toBe(204);
    expect((await laptop.call('GET', '/auth/me')).statusCode).toBe(200);
    expect(problemCode(await phone.call('GET', '/auth/me'))).toBe('UNAUTHENTICATED');
  });
});

describe('sessions', () => {
  it("lists your devices and can't touch anyone else's", async () => {
    await createUser('owner@lingua.test');
    await createUser('other@lingua.test');
    const a = newClient();
    const b = newClient();
    const intruder = newClient();
    await a.call('POST', '/auth/login', { email: 'owner@lingua.test', password: PASSWORD });
    await b.call('POST', '/auth/login', { email: 'owner@lingua.test', password: PASSWORD });
    await intruder.call('POST', '/auth/login', { email: 'other@lingua.test', password: PASSWORD });

    const list = (await a.call('GET', '/auth/sessions')).json<{
      items: { id: string; current: boolean }[];
    }>();
    expect(list.items).toHaveLength(2);
    const otherDevice = list.items.find((s) => !s.current);
    if (!otherDevice) throw new Error('expected a second session');

    expect((await intruder.call('DELETE', `/auth/sessions/${otherDevice.id}`)).statusCode).toBe(
      404,
    );
    expect((await a.call('DELETE', `/auth/sessions/${otherDevice.id}`)).statusCode).toBe(204);
    expect(problemCode(await b.call('GET', '/auth/me'))).toBe('UNAUTHENTICATED');
  });
});
