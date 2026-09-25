import type {
  CreateStudentValues,
  Guardian,
  GuardianValues,
  Student,
  StudentListQuery,
  StudentListResponse,
  UpdateStudentValues,
} from '@emis/contracts';
import {
  afterCursor,
  decodeCursor,
  studentGuardians,
  students,
  toPage,
  updateWithVersion,
} from '@emis/db';
import type { Grant } from '@emis/permissions';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';

import { assertBranchAccess, assertScope, branchReach } from '../../../common/authz/scope.js';
import { escapeLike, phonePattern, searchTokens } from '../../../common/db/like.js';
import { versionedRow } from '../../../common/http/versioning.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService } from '../../audit/index.js';
import {
  CustomFieldsService,
  DescriptorsService,
  NumberingService,
  OrganizationService,
} from '../../settings/index.js';
import { studentErrors } from '../domain/errors.js';
import { DuplicatesService } from './duplicates.service.js';

type StudentRow = typeof students.$inferSelect;
type GuardianRow = typeof studentGuardians.$inferSelect;

const toGuardian = (row: GuardianRow): Guardian => ({
  id: row.id,
  name: row.name,
  relationship: row.relationship,
  phone: row.phone,
  email: row.email,
  isPrimary: row.isPrimary,
  isPayer: row.isPayer,
});

const toStudent = (row: StudentRow, guardians: GuardianRow[]): Student => ({
  id: row.id,
  studentNumber: row.studentNumber,
  givenName: row.givenName,
  fatherName: row.fatherName,
  grandfatherName: row.grandfatherName,
  gender: row.gender as Student['gender'],
  dateOfBirth: row.dateOfBirth,
  phone: row.phone,
  email: row.email,
  address: row.address,
  city: row.city,
  status: row.status,
  branchId: row.branchId,
  categoryCode: row.categoryCode,
  customFields: row.customFields,
  guardians: guardians.map(toGuardian),
  createdAt: row.createdAt.toISOString(),
  version: row.version,
});

/**
 * Student records. Reading needs `students.read`; changing needs `students.manage` at the
 * student's branch, so a Secretary at one branch can't touch another branch's students.
 */
@Injectable()
export class StudentsService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly org: OrganizationService,
    private readonly descriptors: DescriptorsService,
    private readonly customFields: CustomFieldsService,
    private readonly numbering: NumberingService,
    private readonly duplicates: DuplicatesService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  private async withGuardians(rows: StudentRow[]): Promise<Student[]> {
    if (rows.length === 0) return [];
    const guardians = await this.db
      .select()
      .from(studentGuardians)
      .where(
        inArray(
          studentGuardians.studentId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(desc(studentGuardians.isPrimary), studentGuardians.createdAt);
    return rows.map((row) =>
      toStudent(
        row,
        guardians.filter((g) => g.studentId === row.id),
      ),
    );
  }

  async list(query: StudentListQuery, grants: readonly Grant[]): Promise<StudentListResponse> {
    const reach = branchReach(grants, 'students.read');
    const conditions: (SQL | undefined)[] = [
      query.status ? eq(students.status, query.status) : undefined,
      query.branchId ? eq(students.branchId, query.branchId) : undefined,
      // A branch-limited caller only ever sees their own branches.
      reach === 'all'
        ? undefined
        : inArray(students.branchId, reach.length > 0 ? reach : [NO_BRANCH]),
    ];

    // Every word must appear in the name, the student number or the phone.
    for (const token of searchTokens(query.q ?? '')) {
      const pattern = `%${escapeLike(token)}%`;
      const phone = phonePattern(token);
      conditions.push(
        or(
          ilike(students.searchName, pattern),
          ilike(students.studentNumber, pattern),
          phone ? ilike(students.phone, phone) : undefined,
        ),
      );
    }
    if (query.cursor) {
      const [createdAt, id] = decodeCursor(query.cursor, 2);
      conditions.push(
        afterCursor([students.createdAt, students.id], [String(createdAt), String(id)], 'desc'),
      );
    }

    const rows = await this.db
      .select()
      .from(students)
      .where(and(...conditions))
      .orderBy(desc(students.createdAt), desc(students.id))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit, (r) => [r.createdAt.toISOString(), r.id]);
    return { items: await this.withGuardians(page.items), nextCursor: page.nextCursor };
  }

  private async row(id: string): Promise<StudentRow> {
    const [row] = await this.db.select().from(students).where(eq(students.id, id));
    if (!row) throw studentErrors.notFound();
    return row;
  }

  async get(id: string, grants: readonly Grant[]): Promise<Student> {
    const row = await this.row(id);
    assertBranchAccess(grants, 'students.read', row.branchId);
    const [student] = await this.withGuardians([row]);
    if (!student) throw studentErrors.notFound();
    return student;
  }

  /** For other modules that need to know a student exists (e.g. linking an applicant to one). */
  async requireExisting(id: string): Promise<StudentRow> {
    return this.row(id);
  }

  @Transactional()
  async create(
    input: CreateStudentValues,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Student> {
    assertScope(grants, 'students.manage', { branchId: input.branchId });
    if (!(await this.org.isActiveUnit('branch', input.branchId))) {
      throw studentErrors.branchNotFound();
    }
    await this.descriptors.assertActiveCode('student_category', input.categoryCode);
    const customFields = await this.customFields.validateValues('student', input.customFields);

    if (!input.confirmNotDuplicate) {
      const candidates = await this.duplicates.find(input);
      if (candidates.length > 0) throw studentErrors.duplicateSuspected();
    }

    const { number } = await this.numbering.next('student');
    const { guardians, confirmNotDuplicate: _confirmed, ...person } = input;
    const [row] = await this.db
      .insert(students)
      .values({
        ...person,
        customFields,
        studentNumber: number,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    if (!row) throw studentErrors.notFound();

    const guardianRows = await this.insertGuardians(row.id, guardians);
    // Personal details stay out of the audit log: it records that, where and by whom.
    await this.audit.record({
      action: 'student.registered',
      entityType: 'student',
      entityId: row.id,
      changes: { studentNumber: row.studentNumber, branchId: row.branchId },
    });
    return toStudent(row, guardianRows);
  }

  @Transactional()
  async update(
    id: string,
    input: UpdateStudentValues,
    expectedVersion: number,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Student> {
    const before = await this.row(id);
    assertScope(grants, 'students.manage', { branchId: before.branchId });

    if (input.categoryCode !== undefined && input.categoryCode !== before.categoryCode) {
      await this.descriptors.assertActiveCode('student_category', input.categoryCode);
    }
    const customFields =
      input.customFields === undefined
        ? undefined
        : await this.customFields.validateValues('student', input.customFields);

    const row = versionedRow(
      await updateWithVersion(this.db, students, id, expectedVersion, {
        ...input,
        customFields,
        updatedBy: actor.userId,
      }),
      studentErrors.notFound,
    );

    await this.audit.record({
      action: 'student.updated',
      entityType: 'student',
      entityId: id,
      // Which fields changed, never their values.
      changes: {
        studentNumber: before.studentNumber,
        fields: Object.keys(input).filter(
          (k) => input[k as keyof UpdateStudentValues] !== undefined,
        ),
        ...(input.status && input.status !== before.status
          ? { status: { from: before.status, to: input.status } }
          : {}),
      },
    });
    const [student] = await this.withGuardians([row]);
    if (!student) throw studentErrors.notFound();
    return student;
  }

  /**
   * Replace the student's guardians. The student's version moves on so two people editing the
   * record together get a 412 instead of overwriting each other.
   */
  @Transactional()
  async setGuardians(
    id: string,
    guardians: GuardianValues[],
    expectedVersion: number,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Student> {
    const before = await this.row(id);
    assertScope(grants, 'students.manage', { branchId: before.branchId });

    const row = versionedRow(
      await updateWithVersion(this.db, students, id, expectedVersion, { updatedBy: actor.userId }),
      studentErrors.notFound,
    );
    await this.db.delete(studentGuardians).where(eq(studentGuardians.studentId, id));
    const rows = await this.insertGuardians(id, guardians);

    await this.audit.record({
      action: 'student.guardians_set',
      entityType: 'student',
      entityId: id,
      changes: { studentNumber: before.studentNumber, guardians: rows.length },
    });
    return toStudent(row, rows);
  }

  private async insertGuardians(
    studentId: string,
    guardians: GuardianValues[],
  ): Promise<GuardianRow[]> {
    if (guardians.length === 0) return [];
    return this.db
      .insert(studentGuardians)
      .values(
        guardians.map((g) => ({
          studentId,
          name: g.name,
          relationship: g.relationship,
          phone: g.phone,
          email: g.email,
          isPrimary: g.isPrimary,
          isPayer: g.isPayer,
        })),
      )
      .returning();
  }
}

/** A UUID nobody has: a caller with no branch access matches no rows. */
const NO_BRANCH = '00000000-0000-0000-0000-000000000000';
