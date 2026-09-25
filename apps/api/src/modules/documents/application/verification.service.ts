import type { Verification } from '@emis/contracts';
import { certificates, studentCards, students } from '@emis/db';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import type { DbAdapter } from '../../../database/database.module.js';
import { InstitutionService } from '../../settings/index.js';
import { documentErrors } from '../domain/errors.js';

/**
 * Answers "is this real?" for whoever scans a QR code. It reveals only what's printed on the
 * document (holder, course or "Student ID", dates, serial; a card's serial is the student number
 * it shows), never contact details or scores, and it can't be used to browse: the token is 256
 * random bits.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly institution: InstitutionService,
  ) {}

  async verify(token: string): Promise<Verification> {
    const db = this.txHost.tx;
    const { name: institutionName } = await this.institution.get();
    const today = await this.institution.today();
    const dateOf = (at: Date | null) => (at ? at.toISOString().slice(0, 10) : null);

    const [cert] = await db.select().from(certificates).where(eq(certificates.token, token));
    if (cert) {
      return {
        kind: 'certificate',
        status: cert.status === 'revoked' ? 'revoked' : 'valid',
        holderName: cert.studentName,
        title: cert.courseName,
        serial: cert.serial,
        issuedOn: cert.completedOn,
        validUntil: null,
        revokedOn: dateOf(cert.revokedAt),
        institutionName,
      };
    }

    const [card] = await db
      .select({
        card: studentCards,
        given: students.givenName,
        father: students.fatherName,
        grand: students.grandfatherName,
        number: students.studentNumber,
      })
      .from(studentCards)
      .innerJoin(students, eq(students.id, studentCards.studentId))
      .where(eq(studentCards.token, token));
    if (card) {
      return {
        kind: 'student_card',
        status:
          card.card.status === 'revoked'
            ? 'revoked'
            : card.card.validUntil < today
              ? 'expired'
              : 'valid',
        holderName: [card.given, card.father, card.grand].filter(Boolean).join(' '),
        title: 'Student ID',
        serial: card.number,
        issuedOn: card.card.validFrom,
        validUntil: card.card.validUntil,
        revokedOn: dateOf(card.card.revokedAt),
        institutionName,
      };
    }
    throw documentErrors.verificationNotFound();
  }
}
