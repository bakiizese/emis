import { randomUUID } from 'node:crypto';

import { problemDetailsSchema } from '@emis/contracts';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Body, Controller, ConflictException, Injectable, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { DbAdapter } from '../../database/database.module.js';
import { Public } from '../../modules/identity/index.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { Idempotent } from './idempotent.decorator.js';

const urls = inject('database');

@Injectable()
class ProbeWriter {
  constructor(private readonly txHost: TransactionHost<DbAdapter>) {}

  async write(label: string, fail: boolean) {
    await this.txHost.tx.execute(sql`INSERT INTO idem_probe (label) VALUES (${label})`);
    if (fail) throw new ConflictException({ code: 'PROBE_FAILED', message: 'probe asked to fail' });
    // Slow enough that concurrent duplicates really overlap.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { label, token: randomUUID() };
  }
}

@Public()
@Controller('idem-probe')
class ProbeController {
  constructor(private readonly writer: ProbeWriter) {}

  @Post()
  @Idempotent()
  create(@Body() body: { label: string; fail?: boolean }) {
    return this.writer.write(body.label, body.fail ?? false);
  }
}

let app: NestFastifyApplication;
let db: pg.Client;

const post = (key: string | null, body: object): Promise<LightMyRequestResponse> =>
  app.inject({
    method: 'POST',
    url: '/api/v1/idem-probe',
    payload: body,
    headers: key ? { 'idempotency-key': key } : {},
  });
const rows = async (label: string) =>
  Number(
    (
      await db.query<{ n: string }>('SELECT count(*) AS n FROM idem_probe WHERE label = $1', [
        label,
      ])
    ).rows[0]?.n,
  );

beforeAll(async () => {
  db = new pg.Client({ connectionString: urls.migratorUrl });
  await db.connect();
  await db.query('CREATE TABLE idem_probe (id serial PRIMARY KEY, label text NOT NULL)');
  app = await createTestApp({
    env: { DATABASE_URL: urls.appUrl, RATE_LIMIT_MAX: '10000' },
    controllers: [ProbeController],
    providers: [ProbeWriter],
  });
});

afterAll(async () => {
  await app.close();
  await db.query('DROP TABLE IF EXISTS idem_probe');
  await db.end();
});

describe('Idempotency-Key', () => {
  it('replays the first response instead of doing the work again', async () => {
    const key = randomUUID();
    const first = await post(key, { label: 'replay' });
    const second = await post(key, { label: 'replay' });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(await rows('replay')).toBe(1);
  });

  it('runs the work exactly once under concurrent duplicates', async () => {
    const key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => post(key, { label: 'race' })),
    );

    expect(responses.every((r) => r.statusCode === 201)).toBe(true);
    expect(new Set(responses.map((r) => r.body)).size).toBe(1);
    expect(await rows('race')).toBe(1);
  });

  it('refuses a key reused for a different request', async () => {
    const key = randomUUID();
    await post(key, { label: 'original' });
    const reused = await post(key, { label: 'different' });
    expect(reused.statusCode).toBe(422);
    expect(problemDetailsSchema.parse(reused.json()).code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('rolls back failed work and releases the key for a retry', async () => {
    const key = randomUUID();
    const failed = await post(key, { label: 'flaky', fail: true });
    expect(failed.statusCode).toBe(409);
    expect(await rows('flaky')).toBe(0);

    const retry = await post(key, { label: 'flaky' });
    expect(retry.statusCode).toBe(201);
    expect(await rows('flaky')).toBe(1);
  });

  it('requires a key, and an unguessable one for anonymous callers', async () => {
    expect(problemDetailsSchema.parse((await post(null, { label: 'x' })).json()).code).toBe(
      'IDEMPOTENCY_KEY_REQUIRED',
    );
    expect(
      problemDetailsSchema.parse((await post('attempt-number-1', { label: 'x' })).json()).code,
    ).toBe('INVALID_IDEMPOTENCY_KEY');
  });
});
