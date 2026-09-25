import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';

import { AppModule } from '../app.module.js';
import { loadEnv } from '../config/env.js';
import { AccountsService } from '../modules/identity/index.js';
import { prompt } from './prompt.js';

/**
 * Creates the first administrator account (two-factor authentication is enforced for it).
 *   pnpm --filter @emis/api account:create-admin
 * Non-interactive (installers/CI): set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const email = process.env.ADMIN_EMAIL ?? (await prompt('Admin email: '));
  const displayName = process.env.ADMIN_NAME ?? (await prompt('Full name: '));
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await prompt('Password (min 12 chars): ', { hidden: true });
    if ((await prompt('Repeat password: ', { hidden: true })) !== password) {
      throw new Error('Passwords do not match.');
    }
  }

  const app = await NestFactory.createApplicationContext(AppModule.forRoot(env), {
    logger: ['error', 'warn'],
  });
  try {
    const cls = app.get(ClsService);
    const { id } = await cls.run(() =>
      app.get(AccountsService).create({ email, displayName, password, mfaEnforced: true }),
    );
    console.warn(
      `Created admin ${email} (${id}). Sign in to the portal to set up two-factor authentication.`,
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
