import { z } from 'zod';

export const DOCUMENT_ERROR_CODES = {
  certificateNotFound: 'CERTIFICATE_NOT_FOUND',
  notEligible: 'NOT_ELIGIBLE_FOR_CERTIFICATE',
  alreadyIssued: 'CERTIFICATE_ALREADY_ISSUED',
  balanceOutstanding: 'BALANCE_OUTSTANDING',
  alreadyRevoked: 'ALREADY_REVOKED',
  cardNotFound: 'STUDENT_CARD_NOT_FOUND',
  verificationNotFound: 'VERIFICATION_NOT_FOUND',
  pdfUnavailable: 'PDF_UNAVAILABLE',
} as const;

// --- certificates ----------------------------------------------------------------------------

export const certificateStatusSchema = z.enum(['issued', 'revoked']);

export const certificateSchema = z.object({
  id: z.uuid(),
  serial: z.string(),
  enrollmentId: z.uuid(),
  studentId: z.uuid(),
  studentName: z.string(),
  courseName: z.string(),
  completedOn: z.iso.date(),
  status: certificateStatusSchema,
  issuedAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  revokedReason: z.string().nullable(),
  version: z.number().int(),
});
export type Certificate = z.infer<typeof certificateSchema>;

export const certificateListQuerySchema = z.object({
  studentId: z.uuid().optional(),
  status: certificateStatusSchema.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CertificateListQuery = z.infer<typeof certificateListQuerySchema>;

export const certificateListResponseSchema = z.object({
  items: z.array(certificateSchema),
  nextCursor: z.string().nullable(),
});
export type CertificateListResponse = z.infer<typeof certificateListResponseSchema>;

export const revokeCertificateRequestSchema = z.object({
  reason: z.string().trim().min(5).max(300),
});
export type RevokeCertificateRequest = z.infer<typeof revokeCertificateRequestSchema>;

// --- student ID cards ------------------------------------------------------------------------

export const studentCardSchema = z.object({
  id: z.uuid(),
  studentId: z.uuid(),
  validFrom: z.iso.date(),
  validUntil: z.iso.date(),
  /** `expired` is worked out on read: an active card past its date. */
  status: z.enum(['active', 'expired', 'revoked']),
  issuedAt: z.iso.datetime(),
});
export type StudentCard = z.infer<typeof studentCardSchema>;

// --- receipts --------------------------------------------------------------------------------

export const RECEIPT_FORMATS = ['a5', 'thermal'] as const;
export const receiptFormatSchema = z.enum(RECEIPT_FORMATS);
export type ReceiptFormat = z.infer<typeof receiptFormatSchema>;
export const receiptQuerySchema = z.object({ format: receiptFormatSchema.default('a5') });

// --- public verification ---------------------------------------------------------------------

/** What anyone holding a QR code may learn. No contact details, no student number, no scores. */
export const verificationSchema = z.object({
  kind: z.enum(['certificate', 'student_card']),
  status: z.enum(['valid', 'revoked', 'expired']),
  holderName: z.string(),
  /** The course for a certificate; "Student ID" for a card. */
  title: z.string(),
  serial: z.string(),
  issuedOn: z.iso.date(),
  validUntil: z.iso.date().nullable(),
  revokedOn: z.iso.date().nullable(),
  institutionName: z.string(),
});
export type Verification = z.infer<typeof verificationSchema>;

/** A verification token as printed in the QR code's link: long, random, URL-safe. */
export const verificationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/);
