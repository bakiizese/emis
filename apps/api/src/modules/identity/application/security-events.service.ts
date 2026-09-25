import { securityEvents } from '@emis/db';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';

import type { DbAdapter } from '../../../database/database.module.js';
import type { RequestContext, SecurityEventType } from '../domain/types.js';

/** Append-only record of authentication events (the DB role can't update or delete them). */
@Injectable()
export class SecurityEventsService {
  constructor(private readonly txHost: TransactionHost<DbAdapter>) {}

  async record(
    type: SecurityEventType,
    context: RequestContext,
    details: { userId?: string | null; metadata?: Record<string, unknown> } = {},
  ): Promise<void> {
    await this.txHost.tx.insert(securityEvents).values({
      type,
      userId: details.userId ?? null,
      ipAddress: context.ip,
      userAgent: context.userAgent,
      metadata: details.metadata ?? {},
    });
  }
}
