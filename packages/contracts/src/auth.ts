import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Stable error codes the frontends switch on (see ProblemDetails.code). */
export const AUTH_ERROR_CODES = {
  invalidCredentials: 'INVALID_CREDENTIALS',
  unauthenticated: 'UNAUTHENTICATED',
  mfaRequired: 'MFA_REQUIRED',
  mfaEnrollmentRequired: 'MFA_ENROLLMENT_REQUIRED',
  invalidMfaCode: 'INVALID_MFA_CODE',
  mfaAlreadyEnabled: 'MFA_ALREADY_ENABLED',
  mfaNotEnabled: 'MFA_NOT_ENABLED',
  mfaEnforced: 'MFA_ENFORCED',
  weakPassword: 'WEAK_PASSWORD',
  invalidResetToken: 'INVALID_RESET_TOKEN',
  invalidCurrentPassword: 'INVALID_CURRENT_PASSWORD',
  csrfRejected: 'CSRF_REJECTED',
} as const;

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Length rules only; the API also rejects guessable passwords (zxcvbn score < 3). */
export const newPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/** Current passwords are never re-validated against today's policy, only bounded. */
const existingPasswordSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app');

export const recoveryCodeSchema = z.string().trim().min(8).max(32);

/** What the client has to do next after signing in. */
export const authNextStepSchema = z.enum(['none', 'mfa', 'mfa_enrollment']);
export type AuthNextStep = z.infer<typeof authNextStepSchema>;

export const authUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: existingPasswordSchema,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.object({
  user: authUserSchema,
  nextStep: authNextStepSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const meResponseSchema = z.object({
  user: authUserSchema.extend({
    mfaEnabled: z.boolean(),
    mfaEnforced: z.boolean(),
  }),
  session: z.object({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    mfaVerified: z.boolean(),
  }),
  nextStep: authNextStepSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const totpSetupResponseSchema = z.object({
  /** Base32 secret for manual entry when the QR code can't be scanned. */
  secret: z.string(),
  otpauthUri: z.string(),
  qrCodeSvg: z.string(),
});
export type TotpSetupResponse = z.infer<typeof totpSetupResponseSchema>;

export const totpConfirmRequestSchema = z.object({ code: totpCodeSchema });
export type TotpConfirmRequest = z.infer<typeof totpConfirmRequestSchema>;

export const recoveryCodesResponseSchema = z.object({
  /** Shown once. Each code works a single time. */
  recoveryCodes: z.array(z.string()),
});
export type RecoveryCodesResponse = z.infer<typeof recoveryCodesResponseSchema>;

export const mfaVerifyRequestSchema = z.union([
  z.object({ code: totpCodeSchema }),
  z.object({ recoveryCode: recoveryCodeSchema }),
]);
export type MfaVerifyRequest = z.infer<typeof mfaVerifyRequestSchema>;

export const disableTotpRequestSchema = z.object({
  password: existingPasswordSchema,
  code: totpCodeSchema,
});
export type DisableTotpRequest = z.infer<typeof disableTotpRequestSchema>;

export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(20).max(200),
  password: newPasswordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: existingPasswordSchema,
  newPassword: newPasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const sessionSummarySchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  current: z.boolean(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const sessionListResponseSchema = z.object({ items: z.array(sessionSummarySchema) });
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;
