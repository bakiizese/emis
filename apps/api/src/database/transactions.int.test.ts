import { baseColumns } from '@emis/db';
import { TransactionHost, Transactional } from '@nestjs-cls/transactional';
import type { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { Injectable } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { ClsService } from 'nestjs-cls';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createTestApp } from '../testing/create-test-app.js';
import type { Database } from './database.module.js';

const notes = pgTable('tx_probe_notes', { ...baseColumns(), body: text().notNull() });

@Injectable()
class AuditProbe {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Database>>) {}

  // No @Transactional here: it must join whatever transaction the caller opened.
  async record(body: string) {
    await this.txHost.tx.insert(notes).values({ body: `audit: ${body}` });
  }
}

@Injectable()
class NotesProbe {
  // Spell out the class (not a type alias) so decorator metadata points at TransactionHost.
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Database>>,
    private readonly audit: AuditProbe,
  ) {}

  @Transactional()
  async create(body: string, fail = false) {
    await this.txHost.tx.insert(notes).values({ body });
    await this.audit.record(body);
    if (fail) throw new Error('boom after both writes');
  }

  async count(body: string) {
    const rows = await this.txHost.tx.select().from(notes).where(eq(notes.body, body));
    return rows.length;
  }
}

describe('@Transactional (real database)', () => {
  let app: NestFastifyApplication;
  let service: NotesProbe;
  let cls: ClsService;
  const urls = inject('database');

  beforeAll(async () => {
    const migrator = new pg.Client({ connectionString: urls.migratorUrl });
    await migrator.connect();
    await migrator.query(`
      CREATE TABLE tx_probe_notes (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid,
        updated_by uuid,
        version integer NOT NULL DEFAULT 1,
        body text NOT NULL
      )`);
    await migrator.end();

    app = await createTestApp({
      env: { DATABASE_URL: urls.appUrl },
      providers: [NotesProbe, AuditProbe],
    });
    service = app.get(NotesProbe);
    cls = app.get(ClsService);
  });

  afterAll(async () => {
    await app.close();
    const migrator = new pg.Client({ connectionString: urls.migratorUrl });
    await migrator.connect();
    await migrator.query('DROP TABLE IF EXISTS tx_probe_notes');
    await migrator.end();
  });

  it('commits writes from nested services together', async () => {
    await cls.run(() => service.create('committed'));
    expect(await cls.run(() => service.count('committed'))).toBe(1);
    expect(await cls.run(() => service.count('audit: committed'))).toBe(1);
  });

  it('rolls back every write in the transaction when anything throws', async () => {
    await expect(cls.run(() => service.create('rolled-back', true))).rejects.toThrow('boom');
    expect(await cls.run(() => service.count('rolled-back'))).toBe(0);
    expect(await cls.run(() => service.count('audit: rolled-back'))).toBe(0);
  });
});
