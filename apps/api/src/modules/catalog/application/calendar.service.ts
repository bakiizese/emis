import type {
  AcademicYear,
  CreateAcademicYearRequest,
  CreateHolidayRequest,
  CreateIntakeRequest,
  Holiday,
  Intake,
  IntakeListQuery,
  UpdateAcademicYearRequest,
  UpdateHolidayRequest,
  UpdateIntakeRequest,
} from '@emis/contracts';
import { academicYears, holidays, intakes, updateWithVersion } from '@emis/db';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { asc, desc, eq } from 'drizzle-orm';

import { isExclusionViolation, isUniqueViolation } from '../../../common/db/errors.js';
import { versionedRow } from '../../../common/http/versioning.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService, diffChanges } from '../../audit/index.js';
import { OrganizationService } from '../../settings/index.js';
import { catalogErrors } from '../domain/errors.js';
import { ProgramsService } from './programs.service.js';

type YearRow = typeof academicYears.$inferSelect;
type IntakeRow = typeof intakes.$inferSelect;
type HolidayRow = typeof holidays.$inferSelect;

const toYear = (row: YearRow): AcademicYear => ({
  id: row.id,
  name: row.name,
  startDate: row.startDate,
  endDate: row.endDate,
  version: row.version,
});

const toIntake = (row: IntakeRow): Intake => ({
  id: row.id,
  programId: row.programId,
  name: row.name,
  startDate: row.startDate,
  registrationOpensAt: row.registrationOpensAt?.toISOString() ?? null,
  registrationClosesAt: row.registrationClosesAt?.toISOString() ?? null,
  isActive: row.isActive,
  version: row.version,
});

const toHoliday = (row: HolidayRow): Holiday => ({
  id: row.id,
  date: row.date,
  name: row.name,
  isRecurringAnnually: row.isRecurringAnnually,
  branchId: row.branchId,
  version: row.version,
});

/** Instants as Date for the database; schema-validated ISO strings in, `null` stays `null`. */
const toDate = (value: string | null | undefined): Date | null | undefined =>
  value === undefined || value === null ? value : new Date(value);

/**
 * The academic calendar: school years, intake windows and holidays. Institution-wide, so it needs
 * `calendar.manage` (Admin) and has no per-department scope.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly programs: ProgramsService,
    private readonly org: OrganizationService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  // --- academic years ------------------------------------------------------------------------

  async listYears(): Promise<AcademicYear[]> {
    const rows = await this.db.select().from(academicYears).orderBy(desc(academicYears.startDate));
    return rows.map(toYear);
  }

  @Transactional()
  async createYear(input: CreateAcademicYearRequest, actor: Actor): Promise<AcademicYear> {
    let row: YearRow | undefined;
    try {
      [row] = await this.db
        .insert(academicYears)
        .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
        .returning();
    } catch (error) {
      throw this.yearConflict(error);
    }
    if (!row) throw catalogErrors.academicYearNotFound();
    await this.audit.record({
      action: 'academic_year.created',
      entityType: 'academic_year',
      entityId: row.id,
      changes: { name: row.name, startDate: row.startDate, endDate: row.endDate },
    });
    return toYear(row);
  }

  @Transactional()
  async updateYear(
    id: string,
    input: UpdateAcademicYearRequest,
    expectedVersion: number,
    actor: Actor,
  ): Promise<AcademicYear> {
    const [before] = await this.db.select().from(academicYears).where(eq(academicYears.id, id));
    if (!before) throw catalogErrors.academicYearNotFound();

    let result;
    try {
      result = await updateWithVersion(this.db, academicYears, id, expectedVersion, {
        ...input,
        updatedBy: actor.userId,
      });
    } catch (error) {
      throw this.yearConflict(error);
    }
    const row = versionedRow(result, catalogErrors.academicYearNotFound);
    await this.audit.record({
      action: 'academic_year.updated',
      entityType: 'academic_year',
      entityId: id,
      changes: { name: before.name, ...diffChanges(before, input) },
    });
    return toYear(row);
  }

  private yearConflict(error: unknown): unknown {
    if (isExclusionViolation(error)) return catalogErrors.academicYearOverlap();
    if (isUniqueViolation(error)) return catalogErrors.codeTaken('academic year');
    return error;
  }

  // --- intakes -------------------------------------------------------------------------------

  async listIntakes(query: IntakeListQuery): Promise<Intake[]> {
    const rows = await this.db
      .select()
      .from(intakes)
      .where(query.programId ? eq(intakes.programId, query.programId) : undefined)
      .orderBy(desc(intakes.startDate), asc(intakes.name));
    return rows.map(toIntake);
  }

  async intakeExists(id: string): Promise<boolean> {
    const [row] = await this.db.select({ id: intakes.id }).from(intakes).where(eq(intakes.id, id));
    return row !== undefined;
  }

  @Transactional()
  async createIntake(input: Required<CreateIntakeRequest>, actor: Actor): Promise<Intake> {
    if (input.programId) {
      await this.programs.row(input.programId).catch(() => {
        throw catalogErrors.programMissing();
      });
    }
    const [row] = await this.db
      .insert(intakes)
      .values({
        ...input,
        registrationOpensAt: toDate(input.registrationOpensAt) ?? null,
        registrationClosesAt: toDate(input.registrationClosesAt) ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    if (!row) throw catalogErrors.intakeNotFound();
    await this.audit.record({
      action: 'intake.created',
      entityType: 'intake',
      entityId: row.id,
      changes: { name: row.name, startDate: row.startDate, programId: row.programId },
    });
    return toIntake(row);
  }

  @Transactional()
  async updateIntake(
    id: string,
    input: UpdateIntakeRequest,
    expectedVersion: number,
    actor: Actor,
  ): Promise<Intake> {
    const [before] = await this.db.select().from(intakes).where(eq(intakes.id, id));
    if (!before) throw catalogErrors.intakeNotFound();

    // The request schema checks the window it was given; the other side comes from the stored row.
    const opens =
      input.registrationOpensAt === undefined
        ? before.registrationOpensAt
        : toDate(input.registrationOpensAt);
    const closes =
      input.registrationClosesAt === undefined
        ? before.registrationClosesAt
        : toDate(input.registrationClosesAt);
    if (opens && closes && closes <= opens) throw catalogErrors.invalidRegistrationWindow();

    const row = versionedRow(
      await updateWithVersion(this.db, intakes, id, expectedVersion, {
        ...input,
        registrationOpensAt: toDate(input.registrationOpensAt),
        registrationClosesAt: toDate(input.registrationClosesAt),
        updatedBy: actor.userId,
      }),
      catalogErrors.intakeNotFound,
    );
    await this.audit.record({
      action: 'intake.updated',
      entityType: 'intake',
      entityId: id,
      changes: { name: before.name, ...diffChanges(toIntake(before), input) },
    });
    return toIntake(row);
  }

  // --- holidays ------------------------------------------------------------------------------

  async listHolidays(): Promise<Holiday[]> {
    const rows = await this.db.select().from(holidays).orderBy(asc(holidays.date));
    return rows.map(toHoliday);
  }

  private async requireBranch(branchId: string | null | undefined): Promise<void> {
    if (branchId && !(await this.org.isActiveUnit('branch', branchId))) {
      throw catalogErrors.branchNotFound();
    }
  }

  @Transactional()
  async createHoliday(input: Required<CreateHolidayRequest>, actor: Actor): Promise<Holiday> {
    await this.requireBranch(input.branchId);
    let row: HolidayRow | undefined;
    try {
      [row] = await this.db
        .insert(holidays)
        .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw catalogErrors.holidayExists();
      throw error;
    }
    if (!row) throw catalogErrors.holidayNotFound();
    await this.audit.record({
      action: 'holiday.created',
      entityType: 'holiday',
      entityId: row.id,
      changes: { date: row.date, name: row.name, branchId: row.branchId },
    });
    return toHoliday(row);
  }

  @Transactional()
  async updateHoliday(
    id: string,
    input: UpdateHolidayRequest,
    expectedVersion: number,
    actor: Actor,
  ): Promise<Holiday> {
    const [before] = await this.db.select().from(holidays).where(eq(holidays.id, id));
    if (!before) throw catalogErrors.holidayNotFound();
    await this.requireBranch(input.branchId);

    let result;
    try {
      result = await updateWithVersion(this.db, holidays, id, expectedVersion, {
        ...input,
        updatedBy: actor.userId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw catalogErrors.holidayExists();
      throw error;
    }
    const row = versionedRow(result, catalogErrors.holidayNotFound);
    await this.audit.record({
      action: 'holiday.updated',
      entityType: 'holiday',
      entityId: id,
      changes: { name: before.name, ...diffChanges(before, input) },
    });
    return toHoliday(row);
  }

  /** Holidays are plain scheduling data (nothing references them yet), so they really are deleted. */
  @Transactional()
  async deleteHoliday(id: string): Promise<void> {
    const [row] = await this.db.delete(holidays).where(eq(holidays.id, id)).returning();
    if (!row) throw catalogErrors.holidayNotFound();
    await this.audit.record({
      action: 'holiday.deleted',
      entityType: 'holiday',
      entityId: id,
      changes: { date: row.date, name: row.name },
    });
  }
}
