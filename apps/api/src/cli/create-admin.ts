import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';

import { AppModule } from '../app.module.js';
import { loadEnv } from '../config/env.js';
import { AdminBootstrapService } from '../modules/access/index.js';
import { prompt } from './prompt.js';

/**
 * Creates an administrator, or grants the Admin role to an existing account (e.g. one created
 * before roles existed, or to recover a locked-out install). Two-factor sign-in is enforced.
 *   pnpm --filter @emis/api account:create-admin
 * Non-interactive (installers/CI): set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(env), {
    logger: ['error', 'warn'],
  });
  try {
    const bootstrap = app.get(AdminBootstrapService);
    const cls = app.get(ClsService);

    const email = process.env.ADMIN_EMAIL ?? (await prompt('Admin email: '));
    const existing = await cls.run(() => bootstrap.findExisting(email));

    let displayName = existing?.displayName ?? '';
    let password: string | undefined;
    if (!existing) {
      displayName = process.env.ADMIN_NAME ?? (await prompt('Full name: '));
      password = process.env.ADMIN_PASSWORD;
      if (!password) {
        password = await prompt('Password (min 12 chars): ', { hidden: true });
        if ((await prompt('Repeat password: ', { hidden: true })) !== password) {
          throw new Error('Passwords do not match.');
        }
      }
    }

    const { userId, created } = await cls.run(() =>
      bootstrap.ensureAdmin({ email, displayName, password }),
    );
    console.warn(
      created
        ? `Created admin ${email} (${userId}). Sign in to the portal to set up two-factor authentication.`
        : `${email} already existed: granted the Admin role (two-factor sign-in is now required).`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const response = (error as { response?: { message?: string } }).response;
  console.error(response?.message ?? (error instanceof Error ? error.message : error));
  process.exit(1);
});
