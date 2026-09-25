import { Inject, Injectable } from '@nestjs/common';

import type { DomainEvent, EventHandler } from '../messaging/events.js';
import { EMAIL_REQUESTED } from './email-outbox.service.js';
import { MAILER, type Mailer, type OutgoingEmail } from './mailer.js';

/** Worker side: actually sends queued emails over SMTP. */
@Injectable()
export class EmailRequestedHandler implements EventHandler<OutgoingEmail> {
  readonly name = 'mail.send';
  readonly eventType = EMAIL_REQUESTED;

  constructor(@Inject(MAILER) private readonly mailer: Mailer) {}

  handle(event: DomainEvent<OutgoingEmail>): Promise<void> {
    return this.mailer.send(event.payload);
  }
}
