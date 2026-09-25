// Public API of the identity module: the only file other modules may import.
export { AccountsService, type NewAccount } from './application/accounts.service.js';
export { SecurityEventsService } from './application/security-events.service.js';
export type { AuthContext, RequestContext } from './domain/types.js';
export { IdentityModule } from './identity.module.js';
export { AuthGuard } from './interface/auth.guard.js';
export { registerCsrfProtection } from './interface/csrf.js';
export { AllowMfaPending, CurrentAuth, Public, ReqContext } from './interface/decorators.js';
