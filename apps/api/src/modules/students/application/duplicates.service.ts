import { type DuplicateCandidate, type DuplicateReason, normalizePhone } from '@emis/contracts';
import { students } from '@emis/db';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { desc, eq, or, type SQL, sql } from 'drizzle-orm';

import type { DbAdapter } from '../../../database/database.module.js';

/** Trigram similarity (0–1) from which two names count as "possibly the same person". */
export const NAME_SIMILARITY_THRESHOLD = 0.45;
const MAX_CANDIDATES = 10;

/** What to look for. Each part is optional; a record's own nulls are fine here. */
export interface DuplicateProbe {
  givenName?: string | null;
  fatherName?: string | null;
  grandfatherName?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * Finds students who may be the person being registered: same phone, same email, or a very similar
 * name. It looks across every branch on purpose (a duplicate at another campus is still a
 * duplicate) and only returns enough to recognize them: name, number, phone.
 */
@Injectable()
export class DuplicatesService {
  constructor(private readonly txHost: TransactionHost<DbAdapter>) {}

  async find(
    query: DuplicateProbe,
    options: { excludeStudentId?: string } = {},
  ): Promise<DuplicateCandidate[]> {
    const name =
      query.givenName && query.fatherName
        ? [query.givenName, query.fatherName, query.grandfatherName]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
        : null;
    const phone = query.phone ? normalizePhone(query.phone) : null;
    const email = query.email ? query.email.trim().toLowerCase() : null;

    const matches: SQL[] = [];
    if (name) {
      matches.push(
        sql`(${students.searchName} % ${name} and similarity(${students.searchName}, ${name}) >= ${NAME_SIMILARITY_THRESHOLD})`,
      );
    }
    if (phone) matches.push(eq(students.phone, phone));
    if (email) matches.push(sql`lower(${students.email}) = ${email}`);
    if (matches.length === 0) return [];

    const similarity = name
      ? sql<number>`similarity(${students.searchName}, ${name})`
      : sql<number>`0`;
    const rows = await this.txHost.tx
      .select({
        id: students.id,
        studentNumber: students.studentNumber,
        givenName: students.givenName,
        fatherName: students.fatherName,
        grandfatherName: students.grandfatherName,
        phone: students.phone,
        email: students.email,
        status: students.status,
        branchId: students.branchId,
        similarity,
      })
      .from(students)
      .where(
        options.excludeStudentId
          ? sql`${or(...matches)} and ${students.id} <> ${options.excludeStudentId}`
          : or(...matches),
      )
      .orderBy(desc(similarity), desc(students.createdAt))
      .limit(MAX_CANDIDATES);

    return rows.map(({ email: rowEmail, similarity: score, ...student }) => {
      const reasons: DuplicateReason[] = [];
      if (phone && student.phone === phone) reasons.push('same_phone');
      if (email && rowEmail?.toLowerCase() === email) reasons.push('same_email');
      if (name && score >= NAME_SIMILARITY_THRESHOLD) reasons.push('similar_name');
      return { student, reasons, similarity: Number(score) };
    });
  }
}
