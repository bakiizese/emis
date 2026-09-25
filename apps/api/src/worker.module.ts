import { type DynamicModule, Module } from '@nestjs/common';

import type { Env } from './config/env.js';
import { CoreModule } from './core/core.module.js';
import { EmailRequestedHandler } from './mail/email-requested.handler.js';
import { MailModule, SmtpModule } from './mail/mail.module.js';
import { EventConsumer } from './messaging/event-consumer.service.js';
import { EventDispatcher } from './messaging/event-dispatcher.service.js';
import { EVENT_HANDLERS, SCHEDULED_JOBS, type ScheduledJob } from './messaging/events.js';
import { MaintenanceJobs } from './messaging/maintenance.service.js';
import { OutboxDrain } from './messaging/outbox-drain.service.js';
import { OutboxRelay } from './messaging/outbox-relay.service.js';
import { BillingModule, FeeRemindersService } from './modules/billing/index.js';

const HOUR = 3_600_000;

/** Every event handler the worker runs. Add new ones here. */
const HANDLERS = [EmailRequestedHandler];

@Module({})
export class WorkerModule {
  /** `consume: false` wires the handlers without queues (tests drain the outbox directly). */
  static forRoot(env: Env, options: { consume: boolean } = { consume: true }): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        CoreModule.forRoot(env, { http: false }),
        SmtpModule,
        // Scheduled jobs from domain modules need those modules (and the outbox to queue email).
        ...(options.consume ? [MailModule, BillingModule] : []),
      ],
      providers: [
        ...HANDLERS,
        {
          provide: EVENT_HANDLERS,
          useFactory: (...handlers: unknown[]) => handlers,
          inject: HANDLERS,
        },
        EventDispatcher,
        OutboxDrain,
        ...(options.consume
          ? [
              {
                provide: SCHEDULED_JOBS,
                inject: [FeeRemindersService],
                // Hourly: each run works out the one stage each instalment needs today, so it can
                // run as often as you like without sending anything twice.
                useFactory: (reminders: FeeRemindersService): ScheduledJob[] => [
                  { name: 'send-fee-reminders', every: HOUR, run: () => reminders.run() },
                ],
              },
              OutboxRelay,
              EventConsumer,
              MaintenanceJobs,
            ]
          : []),
      ],
    };
  }
}
