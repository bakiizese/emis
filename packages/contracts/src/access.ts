import { z } from 'zod';

import { emailSchema, newPasswordSchema } from './auth.js';

export const ACCESS_ERROR_CODES = {
  permissionDenied: 'PERMISSION_DENIED',
  roleNotFound: 'ROLE_NOT_FOUND',
  scopeNotAllowed: 'SCOPE_NOT_ALLOWED',
  scopeNotAvailable: 'SCOPE_NOT_AVAILABLE',
  lastAdmin: 'LAST_ADMIN',
  cannotChangeSelf: 'CANNOT_CHANGE_SELF',
  userNotFound: 'USER_NOT_FOUND',
  invalidInvitation: 'INVALID_INVITATION',
  alreadyActivated: 'ALREADY_ACTIVATED',
  roleAlreadyAssigned: 'ROLE_ALREADY_ASSIGNED',
} as const;

export const scopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('global') }),
  z.object({ type: z.literal('branch'), id: z.uuid() }),
  z.object({ type: z.literal('department'), id: z.uuid() }),
]);
export type ScopeInput = z.infer<typeof scopeSchema>;

export const roleKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z][a-z0-9_-]*$/);

export const roleSummarySchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  isSystem: z.boolean(),
  mfaRequired: z.boolean(),
  allowedScopes: z.array(z.enum(['global', 'branch', 'department'])),
  permissions: z.array(z.string()),
});
export type RoleSummary = z.infer<typeof roleSummarySchema>;

export const roleListResponseSchema = z.object({ items: z.array(roleSummarySchema) });
export type RoleListResponse = z.infer<typeof roleListResponseSchema>;

export const roleAssignmentSchema = z.object({
  id: z.uuid(),
  roleKey: z.string(),
  roleName: z.string(),
  scope: scopeSchema,
});
export type RoleAssignment = z.infer<typeof roleAssignmentSchema>;

/** Account state as staff admins see it. */
export const staffStatusSchema = z.enum(['invited', 'active', 'disabled']);
export type StaffStatus = z.infer<typeof staffStatusSchema>;

export const staffUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  status: staffStatusSchema,
  mfaEnabled: z.boolean(),
  mfaEnforced: z.boolean(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  roles: z.array(roleAssignmentSchema),
});
export type StaffUser = z.infer<typeof staffUserSchema>;

export const staffListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type StaffListQuery = z.infer<typeof staffListQuerySchema>;

export const staffListResponseSchema = z.object({
  items: z.array(staffUserSchema),
  nextCursor: z.string().nullable(),
});
export type StaffListResponse = z.infer<typeof staffListResponseSchema>;

export const inviteStaffRequestSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(2).max(120),
  roleKey: roleKeySchema,
  scope: scopeSchema.default({ type: 'global' }),
});
export type InviteStaffRequest = z.input<typeof inviteStaffRequestSchema>;

export const assignRoleRequestSchema = z.object({
  roleKey: roleKeySchema,
  scope: scopeSchema.default({ type: 'global' }),
});
export type AssignRoleRequest = z.input<typeof assignRoleRequestSchema>;

export const setStaffStatusRequestSchema = z.object({ status: z.enum(['active', 'disabled']) });
export type SetStaffStatusRequest = z.infer<typeof setStaffStatusRequestSchema>;

export const invitationTokenSchema = z.object({ token: z.string().min(20).max(200) });

export const invitationDetailsSchema = z.object({
  email: z.string(),
  displayName: z.string(),
  expiresAt: z.iso.datetime(),
});
export type InvitationDetails = z.infer<typeof invitationDetailsSchema>;

export const acceptInvitationRequestSchema = z.object({
  token: z.string().min(20).max(200),
  password: newPasswordSchema,
});
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;

/** What the signed-in person may do: drives which screens and buttons the portal shows. */
export const myAccessResponseSchema = z.object({
  roles: z.array(z.object({ key: z.string(), name: z.string(), scope: scopeSchema })),
  permissions: z.array(z.string()),
});
export type MyAccessResponse = z.infer<typeof myAccessResponseSchema>;
