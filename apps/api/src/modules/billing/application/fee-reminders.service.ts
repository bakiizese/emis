import { installments, invoices, reminderLog, studentGuardians, students } from '@emis/db';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { and, between, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';

import { addDays } from '../../../common/dates.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { EmailOutbox } from '../../../mail/email-outbox.service.js';
import { InstitutionService, ModulesService } from '../../settings/index.js';
import { reminderEmail } from '../domain/reminder-email.js';
import {
  daysPastDue,
  LOOKAHEAD_DAYS,
  LOOKBACK_DAYS,
  type ReminderStage,
  stageToSend,
} from '../domain/reminder-stages.js';

/**
 * Emails people about fees that are due or overdue, once per stage. Runs from the worker on a
 * schedule (hourly; it is safe to run as often as you like). For every unpaid instalment it works out
 * the one stage that applies today, and only the run that manages to record it in `reminder_log`
 * sends the email: the unique key (instalment, stage) makes "exactly once" hold across workers.
 */
@Injectable()
export class FeeRemindersService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly modules: ModulesService,
    private readonly institution: InstitutionService,
    private readonly emails: EmailOutbox,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  /** How many emails were queued. `today` is for tests; normally it's the institution's date. */
  @Transactional()
  async run(options: { today?: string } = {}): Promise<number> {
    if (!(await this.modules.isEnabled('fee_reminders'))) return 0;
    const today = options.today ?? (await this.institution.today());
    const { name: institutionName } = await this.institution.get();

    const candidates = await this.db
      .select({
        installmentId: installments.id,
        sequence: installments.sequence,
        dueDate: installments.dueDate,
        owed: sql<number>`${installments.amount} - ${installments.paidAmount}`,
        invoiceNumber: invoices.number,
        invoiceCreatedAt: invoices.createdAt,
        currency: invoices.currency,
        studentId: invoices.studentId,
      })
      .from(installments)
      .innerJoin(invoices, eq(invoices.id, installments.invoiceId))
      .where(
        and(
          inArray(invoices.status, ['issued', 'partially_paid']),
          lt(installments.paidAmount, installments.amount),
          between(
            installments.dueDate,
            addDays(today, -LOOKBACK_DAYS),
            addDays(today, LOOKAHEAD_DAYS),
          ),
        ),
      );
    if (candidates.length === 0) return 0;

    const sent = await this.db
      .select({ installmentId: reminderLog.installmentId, stage: reminderLog.stage })
      .from(reminderLog)
      .where(
        inArray(
          reminderLog.installmentId,
          candidates.map((c) => c.installmentId),
        ),
      );
    const studentIds = [...new Set(candidates.map((c) => c.studentId))];
    const people = await this.db
      .select({ id: students.id, email: students.email, givenName: students.givenName })
      .from(students)
      .where(inArray(students.id, studentIds));
    const payers = await this.db
      .select()
      .from(studentGuardians)
      .where(
        and(
          inArray(studentGuardians.studentId, studentIds),
          eq(studentGuardians.isPayer, true),
          isNotNull(studentGuardians.email),
        ),
      );

    let queued = 0;
    for (const c of candidates) {
      // An invoice made today gets its first reminder tomorrow at the earliest: the student is
      // usually standing at the desk paying it.
      if ((await this.institution.localDate(c.invoiceCreatedAt)) === today) continue;

      const already = new Set(
        sent.filter((s) => s.installmentId === c.installmentId).map((s) => s.stage),
      );
      const stage: ReminderStage | null = stageToSend(daysPastDue(today, c.dueDate), already);
      if (!stage) continue;

      // Goes to the payer named on the student's record if there is one, otherwise to the student.
      const payer = payers.find((p) => p.studentId === c.studentId);
      const student = people.find((p) => p.id === c.studentId);
      const to = payer?.email ?? student?.email ?? null;

      const recorded = await this.db
        .insert(reminderLog)
        .values({ installmentId: c.installmentId, stage, outcome: to ? 'queued' : 'no_contact' })
        .onConflictDoNothing()
        .returning({ id: reminderLog.id });
      if (recorded.length === 0 || !to) continue;

      await this.emails.send({
        to,
        ...reminderEmail({
          stage,
          recipientName: payer?.name ?? student?.givenName ?? 'there',
          institutionName,
          invoiceNumber: c.invoiceNumber,
          instalment: c.sequence,
          owed: Number(c.owed),
          currency: c.currency,
          dueDate: c.dueDate,
        }),
      });
      queued += 1;
    }
    return queued;
  }
}
