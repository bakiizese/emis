import { randomUUID } from 'node:crypto';

import { createIsolatedDatabase, type TestDatabaseUrls } from '@emis/db/testing';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { ClsService } from 'nestjs-cls';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { DbAdapter } from '../database/database.module.js';
import { EmailOutbox } from '../mail/email-outbox.service.js';
import { MAILER, type Mailer, type OutgoingEmail } from '../mail/mailer.js';
import { callAs, createStaff } from '../testing/staff-fixtures.js';
import { CapturingMailer } from '../testing/capturing-mailer.js';
import { createTestAppWithMailer, type TestApp, testEnv } from '../testing/create-test-app.js';
import { WorkerModule } from '../worker.module.js';
import { EventDispatcher } from './event-dispatcher.service.js';
import { MaintenanceJobs } from './maintenance.service.js';
import { OutboxService } from './outbox.service.js';

// Own database: these tests count every outbox row, so no other file may add events here.
let urls: TestDatabaseUrls;
let testApp: TestApp;
let db: pg.Client;

const email = (to: string): OutgoingEmail => ({
  to,
  subject: 'Hello',
  text: `secret link for ${to}`,
});

async function inTransaction(fn: () => Promise<void>) {
  const { app } = testApp;
  await app
    .get(ClsService)
    .run(() => app.get<TransactionHost<DbAdapter>>(TransactionHost).withTransaction(fn));
}

beforeAll(async () => {
  urls = await createIsolatedDatabase(inject('database'), 'emis_outbox_test');
  testApp = await createTestAppWithMailer({
    env: { DATABASE_URL: urls.appUrl, RATE_LIMIT_MAX: '10000' },
  });
  db = new pg.Client({ connectionString: urls.appUrl });
  await db.connect();
});

afterAll(async () => {
  await db.end();
  await testApp.app.close();
});

describe('transactional outbox', () => {
  it('only keeps events whose transaction committed', async () => {
    const outbox = testApp.app.get(OutboxService);
    await expect(
      inTransaction(async () => {
        await outbox.publish('test.rolled_back', { n: 1 });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    await inTransaction(() => outbox.publish('test.committed', { n: 2 }));

    const { rows } = await db.query<{ type: string }>(
      "SELECT type FROM outbox_events WHERE type LIKE 'test.%'",
    );
    expect(rows.map((r) => r.type)).toEqual(['test.committed']);
  });

  it('seals sensitive payloads: neither the database nor the queue sees the link', async () => {
    await inTransaction(() => testApp.app.get(EmailOutbox).send(email('sealed@lingua.test')));
    const { rows } = await db.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM outbox_events WHERE type = 'email.requested' ORDER BY id DESC LIMIT 1",
    );
    expect(JSON.stringify(rows[0]?.payload)).not.toContain('secret link');
    expect(rows[0]?.payload.sealed).toMatch(/^v1\./);

    expect((await testApp.mail.lastTo('sealed@lingua.test'))?.text).toBe(
      'secret link for sealed@lingua.test',
    );
  });
});

describe('event dispatch', () => {
  it('handles a redelivered event once', async () => {
    await inTransaction(() => testApp.app.get(EmailOutbox).send(email('once@lingua.test')));
    const [event] = (
      await db.query(
        "SELECT * FROM outbox_events WHERE payload::text NOT LIKE '%rolled%' AND published_at IS NULL",
      )
    ).rows as { id: string; type: string; payload: Record<string, unknown>; occurred_at: Date }[];
    if (!event) throw new Error('no pending event');

    const dispatcher = testApp.worker.get(EventDispatcher);
    const stored = {
      ...event,
      occurredAt: event.occurred_at,
      correlationId: null,
      actorUserId: null,
    };
    expect(await dispatcher.dispatch(stored)).toEqual({ handled: 1, skipped: 0 });
    expect(await dispatcher.dispatch(stored)).toEqual({ handled: 0, skipped: 1 });

    const sent = (await testApp.mail.sent()).filter((m) => m.to === 'once@lingua.test');
    expect(sent).toHaveLength(1);
  });

  it('retries a handler that failed, without losing the event', async () => {
    let calls = 0;
    const flaky: Mailer = {
      send: () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('SMTP down')) : Promise.resolve();
      },
    };
    const workerRef = await Test.createTestingModule({
      imports: [WorkerModule.forRoot(testEnv({ DATABASE_URL: urls.appUrl }), { consume: false })],
    })
      .overrideProvider(MAILER)
      .useValue(flaky)
      .compile();
    const worker = await workerRef.init();
    try {
      await inTransaction(() => testApp.app.get(EmailOutbox).send(email('flaky@lingua.test')));
      const { rows } = await db.query<{
        id: string;
        type: string;
        payload: Record<string, unknown>;
        occurred_at: Date;
      }>("SELECT * FROM outbox_events WHERE type = 'email.requested' AND published_at IS NULL");
      const event = rows[0];
      if (!event) throw new Error('no pending event');
      const stored = {
        ...event,
        occurredAt: event.occurred_at,
        correlationId: null,
        actorUserId: null,
      };

      const dispatcher = worker.get(EventDispatcher);
      await expect(dispatcher.dispatch(stored)).rejects.toThrow('SMTP down');
      expect(await dispatcher.dispatch(stored)).toEqual({ handled: 1, skipped: 0 });
      expect(calls).toBe(2);
    } finally {
      await worker.close();
      await testApp.drain();
    }
  });
});

describe('idempotent invite', () => {
  it('creates one account and sends one email for a retried request', async () => {
    const admin = await createStaff(testApp.app, {
      email: 'outbox-admin@lingua.test',
      roleKey: 'admin',
    });
    const key = randomUUID();
    const body = { email: 'twice@lingua.test', displayName: 'Double Click', roleKey: 'secretary' };
    const first = await callAs(testApp.app, admin)('POST', '/users/invitations', body, {
      'idempotency-key': key,
    });
    const second = await callAs(testApp.app, admin)('POST', '/users/invitations', body, {
      'idempotency-key': key,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    const sent = (await testApp.mail.sent()).filter((m) => m.to === 'twice@lingua.test');
    expect(sent).toHaveLength(1);
  });
});

describe('queue delivery (real Valkey + BullMQ)', () => {
  let valkey: StartedTestContainer;
  let worker: INestApplicationContext;
  const mailer = new CapturingMailer();

  beforeAll(async () => {
    await testApp.drain(); // start from an empty outbox
    valkey = await new GenericContainer('valkey/valkey:8-alpine').withExposedPorts(6379).start();
    const workerRef = await Test.createTestingModule({
      imports: [
        WorkerModule.forRoot(
          testEnv({
            DATABASE_URL: urls.appUrl,
            VALKEY_URL: `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`,
          }),
        ),
      ],
    })
      .overrideProvider(MAILER)
      .useValue(mailer)
      .compile();
    worker = await workerRef.init();
  }, 120_000);

  afterAll(async () => {
    await worker.close();
    await valkey.stop();
  });

  it('delivers a committed event through the relay and the queue, once', async () => {
    await inTransaction(() => testApp.app.get(EmailOutbox).send(email('queued@lingua.test')));

    const deadline = Date.now() + 15_000;
    while (!mailer.lastTo('queued@lingua.test') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(mailer.lastTo('queued@lingua.test')?.text).toBe('secret link for queued@lingua.test');

    // Give any duplicate delivery a chance to show up, then check there wasn't one.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(mailer.sent.filter((m) => m.to === 'queued@lingua.test')).toHaveLength(1);
    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM outbox_events WHERE published_at IS NULL',
    );
    expect(rows[0]).toEqual({ n: 0 });
  });

  it('cleans up expired idempotency keys on schedule', async () => {
    await db.query(
      `INSERT INTO idempotency_keys (principal, key, method, path, request_hash, response_status, expires_at)
       VALUES ('anonymous', 'expired-key-000', 'POST', '/x', 'h', 201, now() - interval '1 minute')`,
    );
    expect(await worker.get(MaintenanceJobs).run('purge-idempotency-keys')).toBeGreaterThanOrEqual(
      1,
    );
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM idempotency_keys WHERE key = 'expired-key-000'",
    );
    expect(rows[0]).toEqual({ n: 0 });
  });
});
