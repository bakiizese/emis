import { randomBytes } from 'node:crypto';

import type { StudentCard } from '@emis/contracts';
import { studentCards } from '@emis/db';
import type { Grant } from '@emis/permissions';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { assertBranchAccess, assertScope } from '../../../common/authz/scope.js';
import { addDays } from '../../../common/dates.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService } from '../../audit/index.js';
import { InstitutionService } from '../../settings/index.js';
import { StudentsService } from '../../students/index.js';
import { documentErrors } from '../domain/errors.js';
import { raw } from '../domain/html.js';
import { qrSvg } from '../domain/qr.js';
import { studentCard as cardTemplate } from '../domain/templates.js';
import { PDF_RENDERER, type PdfRenderer } from '../infrastructure/pdf-renderer.js';
import { DocumentContext } from './document-context.js';

type CardRow = typeof studentCards.$inferSelect;

/** How long a new card is valid for. */
export const CARD_VALID_DAYS = 365;

/**
 * Student ID cards. A student has one active card: issuing again revokes the old one, so a lost
 * or replaced card stops verifying. A card is valid for a year from when it's issued.
 */
@Injectable()
export class StudentCardsService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly students: StudentsService,
    private readonly institution: InstitutionService,
    private readonly context: DocumentContext,
    private readonly audit: AuditService,
    @Inject(PDF_RENDERER) private readonly renderer: PdfRenderer,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  private async toCard(row: CardRow): Promise<StudentCard> {
    const today = await this.institution.today();
    return {
      id: row.id,
      studentId: row.studentId,
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      status: row.status === 'revoked' ? 'revoked' : row.validUntil < today ? 'expired' : 'active',
      issuedAt: row.issuedAt.toISOString(),
    };
  }

  private async activeRow(studentId: string): Promise<CardRow | null> {
    const [row] = await this.db
      .select()
      .from(studentCards)
      .where(and(eq(studentCards.studentId, studentId), eq(studentCards.status, 'active')));
    return row ?? null;
  }

  async current(studentId: string, grants: readonly Grant[]): Promise<StudentCard | null> {
    const student = await this.students.requireExisting(studentId);
    assertBranchAccess(grants, 'students.read', student.branchId);
    const row = await this.activeRow(studentId);
    return row ? this.toCard(row) : null;
  }

  @Transactional()
  async issue(studentId: string, grants: readonly Grant[], actor: Actor): Promise<StudentCard> {
    const student = await this.students.requireExisting(studentId);
    assertScope(grants, 'students.manage', { branchId: student.branchId });
    if (student.status !== 'active') {
      throw documentErrors.notEligible('Only active students can be given an ID card.');
    }

    const now = new Date();
    await this.db
      .update(studentCards)
      .set({ status: 'revoked', revokedAt: now, updatedBy: actor.userId })
      .where(and(eq(studentCards.studentId, studentId), eq(studentCards.status, 'active')));

    const today = await this.institution.today();
    const [row] = await this.db
      .insert(studentCards)
      .values({
        studentId,
        token: randomBytes(32).toString('base64url'),
        validFrom: today,
        validUntil: addDays(today, CARD_VALID_DAYS),
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    if (!row) throw documentErrors.cardNotFound();
    await this.audit.record({
      action: 'student_card.issued',
      entityType: 'student_card',
      entityId: row.id,
      changes: { studentNumber: student.studentNumber, validUntil: row.validUntil },
    });
    return this.toCard(row);
  }

  async pdf(
    studentId: string,
    grants: readonly Grant[],
  ): Promise<{ pdf: Buffer; filename: string }> {
    const student = await this.students.requireExisting(studentId);
    assertBranchAccess(grants, 'students.read', student.branchId);
    const row = await this.activeRow(studentId);
    if (!row) throw documentErrors.cardNotFound();
    const card = await this.toCard(row);
    const verifyUrl = this.context.verifyUrl(row.token);
    const html = cardTemplate({
      letterhead: await this.context.letterhead(),
      studentName: [student.givenName, student.fatherName, student.grandfatherName]
        .filter(Boolean)
        .join(' '),
      studentNumber: student.studentNumber,
      validUntil: await this.context.date(row.validUntil),
      status: card.status,
      qr: raw(await qrSvg(verifyUrl)),
      verifyUrl,
    });
    return { pdf: await this.renderer.render(html), filename: `id-${student.studentNumber}.pdf` };
  }
}
