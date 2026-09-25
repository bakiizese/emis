import { outboxEvents } from '@emis/db';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';

import type { DbAdapter } from '../database/database.module.js';
import { EventDispatcher } from './event-dispatcher.service.js';

/**
 * Delivers pending events straight to the handlers, without the queue. Used by tests (and handy
 * for one-off scripts); production goes through OutboxRelay + EventConsumer.
 */
@Injectable()
export class OutboxDrain {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly cls: ClsService,
    private readonly dispatcher: EventDispatcher,
  ) {}

  async drain(): Promise<number> {
    const pending = await this.cls.run(() =>
      this.txHost.tx
        .select()
        .from(outboxEvents)
        .where(and(isNull(outboxEvents.publishedAt), lte(outboxEvents.availableAt, new Date())))
        .orderBy(asc(outboxEvents.id)),
    );
    for (const event of pending) {
      await this.dispatcher.dispatch(event);
      await this.cls.run(() =>
        this.txHost.tx
          .update(outboxEvents)
          .set({ publishedAt: new Date() })
          .where(eq(outboxEvents.id, event.id)),
      );
    }
    return pending.length;
  }
}
