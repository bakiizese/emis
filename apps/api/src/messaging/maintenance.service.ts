import {
  idempotencyKeys,
  outboxEvents,
  passwordResetTokens,
  processedEvents,
  userInvitations,
  userSessions,
} from '@emis/db';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { and, isNotNull, lt, or, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';

import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import type { DbAdapter } from '../database/database.module.js';
import { QUEUES, SCHEDULED_JOBS, type ScheduledJob } from './events.js';
import { queueConnection } from './queue-connection.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

/**
 * Housekeeping on a schedule. Job schedulers have fixed ids, so running several workers never
 * duplicates a job. Append-only tables (audit log, security events) are never purged here.
 */
@Injectable()
export class MaintenanceJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MaintenanceJobs.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(APP_CONFIG) private readonly env: Env,
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly cls: ClsService,
    @Optional() @Inject(SCHEDULED_JOBS) private readonly contributed: ScheduledJob[] = [],
  ) {}

  readonly jobs: Record<string, { every: number; run: () => Promise<number> }> = {
    'purge-idempotency-keys': {
      every: HOUR,
      run: async () =>
        (
          await this.txHost.tx
            .delete(idempotencyKeys)
            .where(lt(idempotencyKeys.expiresAt, new Date()))
            .returning({ id: idempotencyKeys.id })
        ).length,
    },
    'purge-delivered-events': {
      every: DAY,
      run: async () => {
        const events = await this.txHost.tx
          .delete(outboxEvents)
          .where(and(isNotNull(outboxEvents.publishedAt), lt(outboxEvents.publishedAt, daysAgo(7))))
          .returning({ id: outboxEvents.id });
        await this.txHost.tx
          .delete(processedEvents)
          .where(lt(processedEvents.processedAt, daysAgo(30)));
        return events.length;
      },
    },
    'purge-dead-sessions': {
      every: DAY,
      run: async () => {
        const cutoff = daysAgo(30);
        const sessions = await this.txHost.tx
          .delete(userSessions)
          .where(
            or(
              lt(userSessions.absoluteExpiresAt, cutoff),
              and(isNotNull(userSessions.revokedAt), lt(userSessions.revokedAt, cutoff)),
            ),
          )
          .returning({ id: userSessions.id });
        await this.txHost.tx
          .delete(passwordResetTokens)
          .where(lt(passwordResetTokens.expiresAt, daysAgo(7)));
        await this.txHost.tx
          .delete(userInvitations)
          .where(
            and(
              lt(userInvitations.createdAt, cutoff),
              sql`(${userInvitations.acceptedAt} is not null or ${userInvitations.revokedAt} is not null or ${userInvitations.expiresAt} < now())`,
            ),
          );
        return sessions.length;
      },
    },
  };

  /** Built-in housekeeping plus the jobs other modules contribute. */
  private get allJobs(): Record<string, { every: number; run: () => Promise<number> }> {
    return {
      ...this.jobs,
      ...Object.fromEntries(this.contributed.map((job) => [job.name, job])),
    };
  }

  async onApplicationBootstrap(): Promise<void> {
    const connection = queueConnection(this.env);
    this.queue = new Queue(QUEUES.maintenance, { connection });
    for (const [name, job] of Object.entries(this.allJobs)) {
      await this.queue.upsertJobScheduler(
        name,
        { every: job.every },
        { name, opts: { removeOnComplete: 100, removeOnFail: 100 } },
      );
    }
    this.worker = new Worker(QUEUES.maintenance, (job) => this.run(job.name), {
      connection,
      concurrency: 1,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async run(name: string): Promise<number> {
    const job = this.allJobs[name];
    if (!job) throw new Error(`unknown maintenance job ${name}`);
    const removed = await this.cls.run(() => this.txHost.withTransaction(job.run));
    if (removed > 0) this.logger.log(`${name}: ${removed}`);
    return removed;
  }
}
