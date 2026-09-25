import { outboxEvents } from '@emis/db';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import { SecretBox } from '../common/crypto/secret-box.js';
import type { AppClsStore } from '../common/request/request-context.js';
import type { DbAdapter } from '../database/database.module.js';

export const sealedContext = (type: string) => `outbox:${type}`;

export interface PublishOptions {
  /** Encrypt the payload at rest (and in the queue). Use for anything holding tokens or links. */
  sensitive?: boolean;
  /** Deliver no earlier than this (e.g. reminders). */
  availableAt?: Date;
}

/**
 * Records an event in the current transaction. It is delivered only if that transaction commits,
 * and it survives crashes: the worker relays it whenever it can.
 */
@Injectable()
export class OutboxService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly box: SecretBox,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async publish(
    type: string,
    payload: Record<string, unknown>,
    options: PublishOptions = {},
  ): Promise<void> {
    const active = this.cls.isActive();
    await this.txHost.tx.insert(outboxEvents).values({
      type,
      payload: options.sensitive
        ? { sealed: this.box.encrypt(JSON.stringify(payload), sealedContext(type)) }
        : payload,
      availableAt: options.availableAt ?? new Date(),
      correlationId: active ? (this.cls.get('request')?.requestId ?? null) : null,
      actorUserId: active ? (this.cls.get('actor')?.userId ?? null) : null,
    });
  }
}
