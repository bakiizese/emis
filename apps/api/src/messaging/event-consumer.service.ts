import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker } from 'bullmq';

import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { EventDispatcher, type StoredEvent } from './event-dispatcher.service.js';
import { QUEUES } from './events.js';
import { queueConnection } from './queue-connection.js';

/** Pulls domain events off the queue and hands them to the dispatcher. Failed jobs retry with backoff. */
@Injectable()
export class EventConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EventConsumer.name);
  private worker?: Worker<StoredEvent>;

  constructor(
    @Inject(APP_CONFIG) private readonly env: Env,
    private readonly dispatcher: EventDispatcher,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<StoredEvent>(
      QUEUES.events,
      async (job) => this.dispatcher.dispatch(job.data),
      {
        connection: queueConnection(this.env),
        concurrency: 5,
      },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.warn(
        `event ${job?.data.type ?? '?'} ${job?.id ?? '?'} failed (attempt ${job?.attemptsMade ?? 0}): ${error.message}`,
      );
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
