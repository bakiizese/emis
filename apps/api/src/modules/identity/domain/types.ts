import type { AuthNextStep } from '@emis/contracts';

/** Who is calling, attached to the request by the AuthGuard. */
export interface AuthContext {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  mfaEnforced: boolean;
  mfaEnabled: boolean;
  mfaVerified: boolean;
  sessionCreatedAt: Date;
  absoluteExpiresAt: Date;
  nextStep: AuthNextStep;
}

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export type SecurityEventType =
  | 'login.succeeded'
  | 'login.failed'
  | 'login.blocked'
  | 'account.locked'
  | 'logout'
  | 'mfa.enabled'
  | 'mfa.disabled'
  | 'mfa.succeeded'
  | 'mfa.failed'
  | 'mfa.recovery_code_used'
  | 'password.reset_requested'
  | 'password.reset'
  | 'password.changed'
  | 'session.revoked';

export function nextStepFor(state: {
  mfaEnabled: boolean;
  mfaEnforced: boolean;
  mfaVerified: boolean;
}): AuthNextStep {
  if (state.mfaVerified) return 'none';
  if (state.mfaEnabled) return 'mfa';
  if (state.mfaEnforced) return 'mfa_enrollment';
  return 'none';
}
