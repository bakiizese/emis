import { type DynamicModule, Module } from '@nestjs/common';

import type { Env } from './config/env.js';
import { CoreModule } from './core/core.module.js';
import { EmailRequestedHandler } from './mail/email-requested.handler.js';
import { SmtpModule } from './mail/mail.module.js';
import { EventConsumer } from './messaging/event-consumer.service.js';
import { EventDispatcher } from './messaging/event-dispatcher.service.js';
import { EVENT_HANDLERS } from './messaging/events.js';
import { MaintenanceJobs } from './messaging/maintenance.service.js';
import { OutboxDrain } from './messaging/outbox-drain.service.js';
import { OutboxRelay } from './messaging/outbox-relay.service.js';

/** Every event handler the worker runs. Add new ones here. */
const HANDLERS = [EmailRequestedHandler];

@Module({})
export class WorkerModule {
  /** `consume: false` wires the handlers without queues (tests drain the outbox directly). */
  static forRoot(env: Env, options: { consume: boolean } = { consume: true }): DynamicModule {
    return {
      module: WorkerModule,
      imports: [CoreModule.forRoot(env, { http: false }), SmtpModule],
      providers: [
        ...HANDLERS,
        {
          provide: EVENT_HANDLERS,
          useFactory: (...handlers: unknown[]) => handlers,
          inject: HANDLERS,
        },
        EventDispatcher,
        OutboxDrain,
        ...(options.consume ? [OutboxRelay, EventConsumer, MaintenanceJobs] : []),
      ],
    };
  }
}
