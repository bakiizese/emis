import { outboxEvents } from '@emis/db';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, asc, inArray, isNull, lte } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import pg from 'pg';

import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import type { DbAdapter } from '../database/database.module.js';
import { QUEUES } from './events.js';
import { queueConnection } from './queue-connection.js';

const BATCH_SIZE = 100;
const POLL_INTERVAL_MS = 5_000;
const RECONNECT_DELAY_MS = 5_000;

/**
 * Moves committed outbox events into the job queue. Woken instantly by Postgres NOTIFY, with a
 * slow poll as a safety net. Rows are claimed with FOR UPDATE SKIP LOCKED, so several workers
 * can run side by side, and the event id is the job id, so a re-relayed event is never queued twice.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private queue?: Queue;
  private listener?: pg.Client;
  private pollTimer?: NodeJS.Timeout;
  private running = false;
  private again = false;
  private stopped = false;

  constructor(
    @Inject(APP_CONFIG) private readonly env: Env,
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly cls: ClsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.queue = new Queue(QUEUES.events, { connection: queueConnection(this.env) });
    await this.listen();
    this.pollTimer = setInterval(() => this.wake(), POLL_INTERVAL_MS);
    this.wake();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearInterval(this.pollTimer);
    await this.listener?.end().catch(() => undefined);
    await this.queue?.close();
  }

  /** Coalesces wake-ups: at most one relay loop at a time, re-run if woken mid-loop. */
  wake(): void {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    void this.relayAll()
      .catch((error: unknown) =>
        this.logger.error(`relay failed: ${error instanceof Error ? error.message : 'unknown'}`),
      )
      .finally(() => {
        this.running = false;
        if (this.again) {
          this.again = false;
          this.wake();
        }
      });
  }

  private async relayAll(): Promise<void> {
    while (!this.stopped && (await this.relayBatch()) === BATCH_SIZE) {
      // keep going while full batches come back
    }
  }

  async relayBatch(): Promise<number> {
    const queue = this.queue;
    if (!queue) return 0;
    return this.cls.run(() =>
      this.txHost.withTransaction(async () => {
        const rows = await this.txHost.tx
          .select()
          .from(outboxEvents)
          .where(and(isNull(outboxEvents.publishedAt), lte(outboxEvents.availableAt, new Date())))
          .orderBy(asc(outboxEvents.id))
          .limit(BATCH_SIZE)
          .for('update', { skipLocked: true });
        if (rows.length === 0) return 0;

        await queue.addBulk(
          rows.map((row) => ({
            name: row.type,
            // Sensitive payloads stay sealed in the queue too; only the handler decrypts them.
            data: {
              id: row.id,
              type: row.type,
              payload: row.payload,
              occurredAt: row.occurredAt.toISOString(),
              correlationId: row.correlationId,
              actorUserId: row.actorUserId,
            },
            opts: {
              jobId: row.id,
              attempts: 8,
              backoff: { type: 'exponential', delay: 2_000 },
              removeOnComplete: { age: 24 * 3600, count: 10_000 },
              removeOnFail: { age: 7 * 24 * 3600 },
            },
          })),
        );
        await this.txHost.tx
          .update(outboxEvents)
          .set({ publishedAt: new Date() })
          .where(
            inArray(
              outboxEvents.id,
              rows.map((row) => row.id),
            ),
          );
        return rows.length;
      }),
    );
  }

  private async listen(): Promise<void> {
    if (this.stopped) return;
    const client = new pg.Client({
      connectionString: this.env.DATABASE_URL,
      application_name: 'emis-outbox-listener',
    });
    const reconnect = () => {
      if (this.stopped || this.listener !== client) return;
      this.listener = undefined;
      setTimeout(() => void this.listen().catch(() => undefined), RECONNECT_DELAY_MS);
    };
    client.on('notification', () => this.wake());
    client.on('error', (error) => {
      this.logger.warn(`outbox listener lost (${error.message}); polling until it reconnects`);
      reconnect();
    });
    client.on('end', reconnect);
    try {
      await client.connect();
      await client.query('LISTEN outbox_events');
      this.listener = client;
    } catch (error) {
      this.logger.warn(
        `outbox listener unavailable: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      await client.end().catch(() => undefined);
      setTimeout(() => void this.listen().catch(() => undefined), RECONNECT_DELAY_MS);
    }
  }
}
