import {
  type CreateStudentValues,
  guardianInputSchema,
  type ImportIssue,
  MAX_REPORTED_ISSUES,
  personFieldsSchema,
  STUDENT_IMPORT_MAX_ROWS,
  type StudentImportColumn,
  type StudentImportResult,
  type StudentImportValues,
} from '@emis/contracts';
import { type Grant, hasPermission } from '@emis/permissions';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';

import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService } from '../../audit/index.js';
import {
  CustomFieldsService,
  DescriptorsService,
  OrganizationService,
} from '../../settings/index.js';
import { DuplicatesService, StudentsService } from '../../students/index.js';
import { CsvError, parseCsv } from '../domain/csv-parse.js';
import { importErrors } from '../domain/errors.js';
import {
  cellOf,
  type HeaderMap,
  mapHeader,
  missingColumns,
  normalizeDate,
  normalizeGender,
} from '../domain/rows.js';

/** Thrown to undo everything a preview did, carrying what it found. */
class DryRunRollback extends Error {
  constructor(readonly result: StudentImportResult) {
    super('dry run');
  }
}

/** Which column a validation error on a request field belongs to. */
const COLUMN_OF: Record<string, StudentImportColumn> = {
  givenName: 'given_name',
  fatherName: 'father_name',
  grandfatherName: 'grandfather_name',
  gender: 'gender',
  dateOfBirth: 'date_of_birth',
  phone: 'phone',
  email: 'email',
  address: 'address',
  city: 'city',
};

/** The same for the guardian columns, whose field names overlap with the student's own. */
const GUARDIAN_COLUMN_OF: Record<string, StudentImportColumn> = {
  name: 'guardian_name',
  relationship: 'guardian_relationship',
  phone: 'guardian_phone',
  email: 'guardian_email',
};

/** What to say about a cell, in the words of the file rather than of the schema behind it. */
function friendlyMessage(field: StudentImportColumn, issue: z.core.$ZodIssue): string {
  if (issue.code === 'custom') return issue.message;
  if (field === 'gender') return 'Use male or female (m or f also work).';
  if (field === 'date_of_birth') return 'Use YYYY-MM-DD or DD/MM/YYYY, and a date in the past.';
  if (field === 'email' || field === 'guardian_email') {
    return "That doesn't look like an email address.";
  }
  return issue.code === 'too_big'
    ? 'This value is too long.'
    : 'This value is missing or not valid.';
}

const shorten = (value: string) => (value.length > 40 ? `${value.slice(0, 40)}…` : value);

/**
 * Adds many students from a CSV file, or shows what that would do. A preview runs the very same
 * steps as the real import and then rolls the transaction back, so it can't disagree with the real
 * thing (student numbers it used are given back too). Imports take one lock, so two at once can't
 * both add the same people, and everything is re-checked on the server every time: a retry of the same
 * file finds those students already there and skips them.
 */
@Injectable()
export class StudentImportService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly students: StudentsService,
    private readonly duplicates: DuplicatesService,
    private readonly org: OrganizationService,
    private readonly descriptors: DescriptorsService,
    private readonly customFields: CustomFieldsService,
    private readonly audit: AuditService,
  ) {}

  async preview(
    input: StudentImportValues,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<StudentImportResult> {
    try {
      await this.txHost.withTransaction(async () => {
        throw new DryRunRollback(await this.run(input, grants, actor, true));
      });
    } catch (error) {
      if (error instanceof DryRunRollback) return error.result;
      throw error;
    }
    throw new Error('unreachable');
  }

  @Transactional()
  async commit(
    input: StudentImportValues,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<StudentImportResult> {
    const result = await this.run(input, grants, actor, false);
    await this.audit.record({
      action: 'students.imported',
      entityType: 'student_import',
      changes: {
        rows: result.totalRows,
        imported: result.imported,
        skippedDuplicates: result.skippedDuplicates,
        skippedErrors: result.skippedErrors,
      },
    });
    return result;
  }

  private parse(csv: string): { map: HeaderMap; rows: { line: number; cells: string[] }[] } {
    let table: ReturnType<typeof parseCsv>;
    try {
      table = parseCsv(csv);
    } catch (error) {
      if (error instanceof CsvError) {
        throw importErrors.invalidFile(`Line ${error.line}: ${error.message}.`);
      }
      throw error;
    }
    const [header, ...rows] = table;
    if (!header || rows.length === 0) {
      throw importErrors.invalidFile(
        'The file has no students in it: it needs a header line and at least one row.',
      );
    }
    if (rows.length > STUDENT_IMPORT_MAX_ROWS)
      throw importErrors.tooManyRows(STUDENT_IMPORT_MAX_ROWS);
    const map = mapHeader(header.cells);
    const missing = missingColumns(map);
    if (missing.length > 0) throw importErrors.missingColumns(missing);
    return { map, rows };
  }

  private async run(
    input: StudentImportValues,
    grants: readonly Grant[],
    actor: Actor,
    dryRun: boolean,
  ): Promise<StudentImportResult> {
    const { map, rows } = this.parse(input.csv);
    // One import at a time: two runs of the same file can't both decide a person is new.
    await this.txHost.tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('emis.student_import'))`,
    );

    const branchByKey = new Map<string, string>();
    for (const branch of await this.org.listBranches()) {
      if (!branch.isActive) continue;
      branchByKey.set(branch.code.toLowerCase(), branch.id);
      branchByKey.set(branch.name.toLowerCase(), branch.id);
    }
    const categories = new Set(
      (await this.descriptors.list('student_category'))
        .filter((d) => d.isActive)
        .map((d) => d.code),
    );
    const customFieldsBlock = await this.customFieldsBlock();

    const issues: ImportIssue[] = [];
    let truncated = false;
    const report = (issue: ImportIssue) => {
      if (issues.length < MAX_REPORTED_ISSUES) issues.push(issue);
      else truncated = true;
    };
    let imported = 0;
    let skippedDuplicates = 0;
    let skippedErrors = 0;

    // Sequential on purpose: the rows share one transaction, and each sees the ones before it.
    for (const { line, cells } of rows) {
      const problems = this.validate(map, cells, branchByKey, categories, grants);
      if (customFieldsBlock) problems.errors.push({ field: null, message: customFieldsBlock });
      if (problems.errors.length > 0 || !problems.student) {
        skippedErrors++;
        for (const e of problems.errors)
          report({ row: line, kind: 'error', field: e.field, message: e.message });
        continue;
      }

      const candidates = await this.duplicates.find(problems.student);
      if (candidates.length > 0 && input.onDuplicate === 'skip') {
        skippedDuplicates++;
        const first = candidates[0];
        const why = first?.reasons.map((r) => r.replace('_', ' ')).join(', ') ?? 'similar details';
        report({
          row: line,
          kind: 'duplicate',
          field: null,
          message: `Looks like ${first?.student.studentNumber ?? 'an existing student'} (${why})${candidates.length > 1 ? ` and ${candidates.length - 1} more` : ''}.`,
        });
        continue;
      }

      await this.students.create({ ...problems.student, confirmNotDuplicate: true }, grants, actor);
      imported++;
    }

    return {
      dryRun,
      totalRows: rows.length,
      imported,
      skippedDuplicates,
      skippedErrors,
      ignoredColumns: map.ignored,
      issues,
      issuesTruncated: truncated,
    };
  }

  /** Required custom fields can't be filled from a file, so an import would fail on every row. */
  private async customFieldsBlock(): Promise<string | null> {
    try {
      await this.customFields.validateValues('student', {});
      return null;
    } catch {
      return "This institution has required custom fields on students, which an import can't fill in yet. Make them optional first.";
    }
  }

  private validate(
    map: HeaderMap,
    cells: readonly string[],
    branchByKey: ReadonlyMap<string, string>,
    categories: ReadonlySet<string>,
    grants: readonly Grant[],
  ): { student?: CreateStudentValues; errors: { field: string | null; message: string }[] } {
    const errors: { field: string | null; message: string }[] = [];
    const cell = (column: StudentImportColumn) => cellOf(map, cells, column);
    const fieldError = (
      error: z.ZodError,
      columns: Record<string, StudentImportColumn>,
      fallback: StudentImportColumn,
    ) => {
      for (const issue of error.issues) {
        const key = String(issue.path[0] ?? '');
        const field = columns[key] ?? fallback;
        errors.push({ field, message: friendlyMessage(field, issue) });
      }
    };

    const person = personFieldsSchema.safeParse({
      givenName: cell('given_name'),
      fatherName: cell('father_name'),
      grandfatherName: cell('grandfather_name'),
      gender: normalizeGender(cell('gender')),
      dateOfBirth: normalizeDate(cell('date_of_birth')),
      phone: cell('phone'),
      email: cell('email'),
      address: cell('address'),
      city: cell('city'),
    });
    if (!person.success) fieldError(person.error, COLUMN_OF, 'given_name');

    const branchText = cell('branch');
    const branchId = branchByKey.get(branchText.toLowerCase());
    if (!branchId) {
      errors.push({
        field: 'branch',
        message:
          branchText === ''
            ? 'Branch is missing.'
            : `No active branch matches “${shorten(branchText)}”.`,
      });
    } else if (!hasPermission(grants, 'students.manage', { branchId })) {
      errors.push({ field: 'branch', message: "You can't add students to this branch." });
    }

    const category = cell('category');
    if (category !== '' && !categories.has(category)) {
      errors.push({
        field: 'category',
        message: `“${shorten(category)}” is not a student category.`,
      });
    }

    const guardianName = cell('guardian_name');
    const guardianPhone = cell('guardian_phone');
    let guardians: CreateStudentValues['guardians'] = [];
    if (guardianName !== '' || guardianPhone !== '') {
      const guardian = guardianInputSchema.safeParse({
        name: guardianName,
        relationship: cell('guardian_relationship') || 'Guardian',
        phone: guardianPhone,
        email: cell('guardian_email'),
        isPrimary: true,
        isPayer: true,
      });
      if (guardian.success) guardians = [guardian.data];
      else fieldError(guardian.error, GUARDIAN_COLUMN_OF, 'guardian_name');
    }

    if (errors.length > 0 || !person.success || !branchId) return { errors };
    return {
      errors,
      student: {
        ...person.data,
        branchId,
        categoryCode: category === '' ? null : category,
        customFields: {},
        guardians,
        confirmNotDuplicate: false,
      },
    };
  }
}
