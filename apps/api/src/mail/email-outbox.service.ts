import { Injectable } from '@nestjs/common';

import { OutboxService } from '../messaging/outbox.service.js';
import type { OutgoingEmail } from './mailer.js';

export const EMAIL_REQUESTED = 'email.requested';

/**
 * How the API sends email: queued in the caller's transaction (so a rolled-back change sends
 * nothing) and encrypted at rest (reset and invitation links are credentials). The worker delivers it.
 */
@Injectable()
export class EmailOutbox {
  constructor(private readonly outbox: OutboxService) {}

  send(email: OutgoingEmail): Promise<void> {
    return this.outbox.publish(EMAIL_REQUESTED, { ...email }, { sensitive: true });
  }
}
