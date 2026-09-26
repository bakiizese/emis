import { z } from 'zod';

export const IMPORT_ERROR_CODES = {
  invalidFile: 'INVALID_IMPORT_FILE',
  tooManyRows: 'TOO_MANY_ROWS',
  missingColumns: 'MISSING_COLUMNS',
} as const;

/** Largest import in one go. Bigger files are split; the limit keeps one request short and safe to retry. */
export const STUDENT_IMPORT_MAX_ROWS = 2000;
/** Roughly what fits in a request body; the API refuses anything bigger with a clear message. */
export const STUDENT_IMPORT_MAX_BYTES = 900_000;

/** The columns an import understands, in the order the template shows them. */
export const STUDENT_IMPORT_COLUMNS = [
  { key: 'given_name', required: true, example: 'Abebe', note: 'First name' },
  { key: 'father_name', required: true, example: 'Kebede', note: "Father's name" },
  { key: 'grandfather_name', required: false, example: 'Tesfaye', note: "Grandfather's name" },
  { key: 'gender', required: true, example: 'male', note: 'male or female (m, f also work)' },
  {
    key: 'date_of_birth',
    required: false,
    example: '2001-04-23',
    note: 'YYYY-MM-DD or DD/MM/YYYY',
  },
  { key: 'phone', required: true, example: '0911 22 33 44', note: 'Any common format' },
  { key: 'email', required: false, example: 'abebe@example.com', note: '' },
  { key: 'address', required: false, example: 'Bole Woreda 3', note: '' },
  { key: 'city', required: false, example: 'Addis Ababa', note: '' },
  { key: 'branch', required: true, example: 'BOLE', note: 'The branch code, or its exact name' },
  { key: 'category', required: false, example: 'regular', note: 'A student category code' },
  {
    key: 'guardian_name',
    required: false,
    example: 'Kebede Alemu',
    note: 'For students who have one',
  },
  {
    key: 'guardian_relationship',
    required: false,
    example: 'Father',
    note: 'Defaults to "Guardian"',
  },
  {
    key: 'guardian_phone',
    required: false,
    example: '0922 33 44 55',
    note: 'Needed with a guardian name',
  },
  { key: 'guardian_email', required: false, example: '', note: '' },
] as const;
export type StudentImportColumn = (typeof STUDENT_IMPORT_COLUMNS)[number]['key'];

export const studentImportRequestSchema = z.object({
  /** The whole file as text (UTF-8 CSV, first line is the header). */
  csv: z.string().min(1).max(STUDENT_IMPORT_MAX_BYTES),
  /**
   * What to do with someone who looks like a student we already have (same phone or email, or a very
   * similar name): leave them out (default) or add them anyway.
   */
  onDuplicate: z.enum(['skip', 'import']).default('skip'),
});
export type StudentImportRequest = z.input<typeof studentImportRequestSchema>;
export type StudentImportValues = z.output<typeof studentImportRequestSchema>;

export const importIssueSchema = z.object({
  /** The line in the file (the header is line 1). */
  row: z.number().int(),
  kind: z.enum(['error', 'duplicate']),
  /** The column at fault, when one is. */
  field: z.string().nullable(),
  /** Never contains the person's details, only what is wrong. */
  message: z.string(),
});
export type ImportIssue = z.infer<typeof importIssueSchema>;

export const MAX_REPORTED_ISSUES = 500;

export const studentImportResultSchema = z.object({
  /** True when nothing was saved: this is what an import would do. */
  dryRun: z.boolean(),
  totalRows: z.number().int(),
  /** Students added (or, for a dry run, that would be added). */
  imported: z.number().int(),
  skippedDuplicates: z.number().int(),
  skippedErrors: z.number().int(),
  /** Columns in the file that the import doesn't use. */
  ignoredColumns: z.array(z.string()),
  issues: z.array(importIssueSchema),
  /** True when there were more issues than `MAX_REPORTED_ISSUES`; the counts above are still exact. */
  issuesTruncated: z.boolean(),
});
export type StudentImportResult = z.infer<typeof studentImportResultSchema>;
