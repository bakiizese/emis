import { randomBytes } from 'node:crypto';

import type { Certificate, CertificateListQuery, CertificateListResponse } from '@emis/contracts';
import {
  afterCursor,
  certificates,
  decodeCursor,
  students,
  toPage,
  updateWithVersion,
} from '@emis/db';
import type { Grant } from '@emis/permissions';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';

import { assertBranchAccess, assertScope, branchReach } from '../../../common/authz/scope.js';
import { isUniqueViolation } from '../../../common/db/errors.js';
import { versionedRow } from '../../../common/http/versioning.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService } from '../../audit/index.js';
import { InvoicesService } from '../../billing/index.js';
import { CoursesService } from '../../catalog/index.js';
import { EnrollmentsService } from '../../cohorts/index.js';
import { InstitutionService, NumberingService } from '../../settings/index.js';
import { StudentsService } from '../../students/index.js';
import { documentErrors } from '../domain/errors.js';
import { raw } from '../domain/html.js';
import { qrSvg } from '../domain/qr.js';
import { certificate as certificateTemplate } from '../domain/templates.js';
import { PDF_RENDERER, type PdfRenderer } from '../infrastructure/pdf-renderer.js';
import { DocumentContext } from './document-context.js';

type CertificateRow = typeof certificates.$inferSelect;

/** A UUID nobody has: a caller with no branch access matches no rows. */
const NO_BRANCH = '00000000-0000-0000-0000-000000000000';

const toCertificate = (row: CertificateRow): Certificate => ({
  id: row.id,
  serial: row.serial,
  enrollmentId: row.enrollmentId,
  studentId: row.studentId,
  studentName: row.studentName,
  courseName: row.courseName,
  completedOn: row.completedOn,
  status: row.status as Certificate['status'],
  issuedAt: row.issuedAt.toISOString(),
  revokedAt: row.revokedAt?.toISOString() ?? null,
  revokedReason: row.revokedReason,
  version: row.version,
});

/**
 * Certificates of completion. One is issued to a student who completed a course whose rules
 * allow it (and, if the institution says so, has paid in full). Names are copied onto it when it's
 * issued, it carries a random token for its QR code, and revoking it (never deleting) makes the
 * public check say so. To reissue, revoke and issue again.
 */
@Injectable()
export class CertificatesService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly enrollments: EnrollmentsService,
    private readonly courses: CoursesService,
    private readonly students: StudentsService,
    private readonly invoices: InvoicesService,
    private readonly institution: InstitutionService,
    private readonly numbering: NumberingService,
    private readonly context: DocumentContext,
    private readonly audit: AuditService,
    @Inject(PDF_RENDERER) private readonly renderer: PdfRenderer,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  // --- reading -------------------------------------------------------------------------------

  async list(
    query: CertificateListQuery,
    grants: readonly Grant[],
  ): Promise<CertificateListResponse> {
    const reach = branchReach(grants, 'certificates.read');
    const conditions: (SQL | undefined)[] = [
      query.studentId ? eq(certificates.studentId, query.studentId) : undefined,
      query.status ? eq(certificates.status, query.status) : undefined,
      reach === 'all'
        ? undefined
        : inArray(
            certificates.studentId,
            this.db
              .select({ id: students.id })
              .from(students)
              .where(inArray(students.branchId, reach.length > 0 ? reach : [NO_BRANCH])),
          ),
    ];
    if (query.cursor) {
      const [issuedAt, id] = decodeCursor(query.cursor, 2);
      conditions.push(
        afterCursor(
          [certificates.issuedAt, certificates.id],
          [String(issuedAt), String(id)],
          'desc',
        ),
      );
    }
    const rows = await this.db
      .select()
      .from(certificates)
      .where(and(...conditions))
      .orderBy(desc(certificates.issuedAt), desc(certificates.id))
      .limit(query.limit + 1);
    const page = toPage(rows, query.limit, (r) => [r.issuedAt.toISOString(), r.id]);
    return { items: page.items.map(toCertificate), nextCursor: page.nextCursor };
  }

  private async row(id: string, grants: readonly Grant[]): Promise<CertificateRow> {
    const [row] = await this.db.select().from(certificates).where(eq(certificates.id, id));
    if (!row) throw documentErrors.certificateNotFound();
    const student = await this.students.requireExisting(row.studentId);
    assertBranchAccess(grants, 'certificates.read', student.branchId);
    return row;
  }

  async get(id: string, grants: readonly Grant[]): Promise<Certificate> {
    return toCertificate(await this.row(id, grants));
  }

  // --- issuing -------------------------------------------------------------------------------

  /**
   * Issue a certificate for a completed enrollment. Refused unless the student completed the
   * course, the course awards certificates, and (when the institution requires it) nothing is owed.
   * Who may is decided by the course's department, so a Coordinator certifies their own.
   */
  @Transactional()
  async issue(enrollmentId: string, grants: readonly Grant[], actor: Actor): Promise<Certificate> {
    const ctx = await this.enrollments.billingContext(enrollmentId);
    if (!ctx) throw documentErrors.notEligible("That enrollment doesn't exist.");
    const course = await this.courses.findWithDepartment(ctx.courseId);
    if (!course) throw documentErrors.notEligible("That course doesn't exist.");
    assertScope(grants, 'certificates.issue', {
      departmentId: course.departmentId,
      branchId: ctx.branchId,
    });

    if (ctx.status !== 'completed' || !ctx.completedAt) {
      throw documentErrors.notEligible(
        'Only students who completed the course can be given a certificate.',
      );
    }
    if (!course.course.certificateEligible) {
      throw documentErrors.notEligible('This course does not award a certificate.');
    }
    const { certificateRequiresPaidInFull } = await this.institution.get();
    if (certificateRequiresPaidInFull) {
      const balance = await this.invoices.balanceForEnrollment(enrollmentId);
      if (balance !== null && balance > 0) throw documentErrors.balanceOutstanding();
    }

    const student = await this.students.requireExisting(ctx.studentId);
    const { number: serial } = await this.numbering.next('certificate');
    let row: CertificateRow | undefined;
    try {
      [row] = await this.db
        .insert(certificates)
        .values({
          serial,
          enrollmentId,
          studentId: ctx.studentId,
          courseId: ctx.courseId,
          studentName: [student.givenName, student.fatherName, student.grandfatherName]
            .filter(Boolean)
            .join(' '),
          courseName: course.course.name,
          completedOn: await this.institution.localDate(ctx.completedAt),
          token: randomBytes(32).toString('base64url'),
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw documentErrors.alreadyIssued();
      throw error;
    }
    if (!row) throw documentErrors.certificateNotFound();

    await this.audit.record({
      action: 'certificate.issued',
      entityType: 'certificate',
      entityId: row.id,
      changes: { serial: row.serial, studentNumber: student.studentNumber, enrollmentId },
    });
    return toCertificate(row);
  }

  @Transactional()
  async revoke(
    id: string,
    reason: string,
    expectedVersion: number,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Certificate> {
    const found = await this.row(id, grants);
    if (found.status === 'revoked') throw documentErrors.alreadyRevoked();
    const row = versionedRow(
      await updateWithVersion(this.db, certificates, id, expectedVersion, {
        status: 'revoked',
        revokedAt: new Date(),
        revokedReason: reason,
        updatedBy: actor.userId,
      }),
      documentErrors.certificateNotFound,
    );
    await this.audit.record({
      action: 'certificate.revoked',
      entityType: 'certificate',
      entityId: id,
      changes: { serial: found.serial, reason },
    });
    return toCertificate(row);
  }

  // --- printing ------------------------------------------------------------------------------

  async pdf(id: string, grants: readonly Grant[]): Promise<{ pdf: Buffer; filename: string }> {
    const row = await this.row(id, grants);
    const verifyUrl = this.context.verifyUrl(row.token);
    const html = certificateTemplate({
      letterhead: await this.context.letterhead(),
      studentName: row.studentName,
      courseName: row.courseName,
      completedOn: await this.context.date(row.completedOn),
      serial: row.serial,
      status: row.status as 'issued' | 'revoked',
      qr: raw(await qrSvg(verifyUrl)),
      verifyUrl,
    });
    return { pdf: await this.renderer.render(html), filename: `certificate-${row.serial}.pdf` };
  }
}
