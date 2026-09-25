import { Global, Module } from '@nestjs/common';

import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { MAILER } from './mailer.js';
import { SmtpMailer } from './smtp-mailer.js';

@Global()
@Module({
  providers: [
    { provide: MAILER, inject: [APP_CONFIG], useFactory: (env: Env) => new SmtpMailer(env) },
  ],
  exports: [MAILER],
})
export class MailModule {}
