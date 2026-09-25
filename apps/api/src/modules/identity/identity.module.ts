import { Module } from '@nestjs/common';

import { AccountsService } from './application/accounts.service.js';
import { AuthService } from './application/auth.service.js';
import { MfaService } from './application/mfa.service.js';
import { PasswordService } from './application/password.service.js';
import { SecurityEventsService } from './application/security-events.service.js';
import { SessionsService } from './application/sessions.service.js';
import { PasswordPolicy } from './domain/password-policy.js';
import { PasswordHasher } from './infrastructure/password-hasher.js';
import { TotpProvider } from './infrastructure/totp.js';
import { AuthController } from './interface/auth.controller.js';
import { AuthGuard } from './interface/auth.guard.js';
import { MfaController } from './interface/mfa.controller.js';
import { SessionCookie } from './interface/session-cookie.js';
import { SessionsController } from './interface/sessions.controller.js';

@Module({
  controllers: [AuthController, MfaController, SessionsController],
  providers: [
    AccountsService,
    AuthService,
    MfaService,
    PasswordService,
    SecurityEventsService,
    SessionsService,
    PasswordHasher,
    { provide: PasswordPolicy, useFactory: () => new PasswordPolicy() },
    TotpProvider,
    SessionCookie,
    AuthGuard,
  ],
  exports: [AccountsService, SessionsService, SessionCookie, AuthGuard, SecurityEventsService],
})
export class IdentityModule {}
