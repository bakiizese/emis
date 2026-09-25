import { processedEvents } from '@emis/db';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import { SecretBox } from '../common/crypto/secret-box.js';
import type { DbAdapter } from '../database/database.module.js';
import { type DomainEvent, EVENT_HANDLERS, type EventHandler } from './events.js';
import { sealedContext } from './outbox.service.js';

export interface StoredEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: Date | string;
  correlationId: string | null;
  actorUserId: string | null;
}

/**
 * Runs every handler registered for an event, each exactly once: the inbox row and the handler's
 * own database writes commit together, so a redelivered event is skipped by handlers that
 * already succeeded and retried by those that failed.
 */
@Injectable()
export class EventDispatcher {
  private readonly logger = new Logger(EventDispatcher.name);

  constructor(
    @Inject(EVENT_HANDLERS) private readonly handlers: EventHandler[],
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly cls: ClsService,
    private readonly box: SecretBox,
  ) {}

  async dispatch(stored: StoredEvent): Promise<{ handled: number; skipped: number }> {
    const event: DomainEvent = {
      id: stored.id,
      type: stored.type,
      payload: this.unseal(stored),
      occurredAt: new Date(stored.occurredAt).toISOString(),
      correlationId: stored.correlationId,
      actorUserId: stored.actorUserId,
    };

    let handled = 0;
    let skipped = 0;
    for (const handler of this.handlers.filter((h) => h.eventType === event.type)) {
      const ran = await this.cls.run(() =>
        this.txHost.withTransaction(async () => {
          const claimed = await this.txHost.tx
            .insert(processedEvents)
            .values({ consumer: handler.name, eventId: event.id })
            .onConflictDoNothing()
            .returning({ eventId: processedEvents.eventId });
          if (claimed.length === 0) return false;
          await handler.handle(event);
          return true;
        }),
      );
      if (ran) handled += 1;
      else skipped += 1;
    }
    if (handled === 0 && skipped === 0) this.logger.debug(`no handler for ${event.type}`);
    return { handled, skipped };
  }

  private unseal(stored: StoredEvent): Record<string, unknown> {
    const sealed = stored.payload.sealed;
    if (typeof sealed !== 'string') return stored.payload;
    return JSON.parse(this.box.decrypt(sealed, sealedContext(stored.type))) as Record<
      string,
      unknown
    >;
  }
}
