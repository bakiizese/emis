import { type DynamicModule, Global, Module } from '@nestjs/common';

import type { Env } from './env.js';

/** Injection token for the validated environment: `@Inject(APP_CONFIG) env: Env`. */
export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({})
export class ConfigModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: Object.freeze({ ...env }) }],
      exports: [APP_CONFIG],
    };
  }
}
