import { Global, Module } from '@nestjs/common';

import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { EmailOutbox } from './email-outbox.service.js';
import { MAILER } from './mailer.js';
import { SmtpMailer } from './smtp-mailer.js';

/** API side: queue emails through the outbox. */
@Global()
@Module({ providers: [EmailOutbox], exports: [EmailOutbox] })
export class MailModule {}

/** Worker side: the SMTP transport. */
@Global()
@Module({
  providers: [
    { provide: MAILER, inject: [APP_CONFIG], useFactory: (env: Env) => new SmtpMailer(env) },
  ],
  exports: [MAILER],
})
export class SmtpModule {}
