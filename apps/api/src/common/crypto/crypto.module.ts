import { Global, Module } from '@nestjs/common';

import { APP_CONFIG } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { SecretBox } from './secret-box.js';

@Global()
@Module({
  providers: [
    {
      provide: SecretBox,
      inject: [APP_CONFIG],
      useFactory: (env: Env) => new SecretBox(env.ENCRYPTION_KEY, env.ENCRYPTION_KEYS_PREVIOUS),
    },
  ],
  exports: [SecretBox],
})
export class CryptoModule {}
