import { z } from 'zod';

export const auditEntrySchema = z.object({
  id: z.uuid(),
  seq: z.number().int(),
  occurredAt: z.iso.datetime(),
  actorUserId: z.uuid().nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  changes: z.record(z.string(), z.unknown()),
  requestId: z.string().nullable(),
  ipAddress: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditListQuerySchema = z.object({
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(80).optional(),
  entityId: z.string().trim().max(80).optional(),
  actorUserId: z.uuid().optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

export const auditListResponseSchema = z.object({
  items: z.array(auditEntrySchema),
  nextCursor: z.string().nullable(),
});
export type AuditListResponse = z.infer<typeof auditListResponseSchema>;

export const auditVerifyResponseSchema = z.object({
  intact: z.boolean(),
  checked: z.number().int(),
  /** First row whose hash doesn't match: everything from here on can't be trusted. */
  brokenAtSeq: z.number().int().nullable(),
});
export type AuditVerifyResponse = z.infer<typeof auditVerifyResponseSchema>;
