import {
  type ClassSession,
  type Cohort,
  type CohortListQuery,
  type CohortListResponse,
  type CohortStatus,
  COHORT_TRANSITIONS,
  type CreateCohortValues,
  type UpdateCohortValues,
} from '@emis/contracts';
import {
  afterCursor,
  classSessions,
  cohorts,
  decodeCursor,
  enrollments,
  rooms,
  toPage,
  updateWithVersion,
} from '@emis/db';
import type { Grant } from '@emis/permissions';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';

import { assertBranchAccess, assertScope, branchReach } from '../../../common/authz/scope.js';
import { constraintName, isExclusionViolation } from '../../../common/db/errors.js';
import { versionedRow } from '../../../common/http/versioning.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AccessService } from '../../access/index.js';
import { AuditService } from '../../audit/index.js';
import { CalendarService, CoursesService, FacilitiesService } from '../../catalog/index.js';
import { InstitutionService } from '../../settings/index.js';
import { cohortErrors } from '../domain/errors.js';
import { MAX_SESSIONS, sessionDates } from '../domain/schedule.js';

type CohortRow = typeof cohorts.$inferSelect;

/** A UUID nobody has: a caller with no branch access matches no rows. */
const NO_BRANCH = '00000000-0000-0000-0000-000000000000';

const SCHEDULE_FIELDS = ['shiftId', 'roomId', 'instructorId', 'startDate', 'endDate'] as const;

const toSession = (row: typeof classSessions.$inferSelect): ClassSession => ({
  id: row.id,
  cohortId: row.cohortId,
  sessionDate: row.sessionDate,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  roomId: row.roomId,
  instructorId: row.instructorId,
});

/**
 * Cohorts (scheduled classes). Who may change one is decided by its course's department and its
 * room's branch, both at once, so a department Coordinator and a branch-scoped role each pass on
 * their own scope. Sessions are generated from the shift's days, skipping holidays, and the
 * database refuses any that would double-book a room or an instructor.
 */
@Injectable()
export class CohortsService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly courses: CoursesService,
    private readonly facilities: FacilitiesService,
    private readonly calendar: CalendarService,
    private readonly institution: InstitutionService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  // --- reading -------------------------------------------------------------------------------

  /** Cohorts with their live numbers (seats, enrolled, waitlist, sessions), in the given order. */
  private async withNumbers(rows: CohortRow[]): Promise<Cohort[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const roomRows = await this.db
      .select({ id: rooms.id, capacity: rooms.capacity })
      .from(rooms)
      .where(
        inArray(
          rooms.id,
          rows.map((r) => r.roomId),
        ),
      );
    const seats = await this.db
      .select({ cohortId: enrollments.cohortId, status: enrollments.status, n: count() })
      .from(enrollments)
      .where(
        and(
          inArray(enrollments.cohortId, ids),
          inArray(enrollments.status, ['active', 'waitlisted']),
        ),
      )
      .groupBy(enrollments.cohortId, enrollments.status);
    const sessionCounts = await this.db
      .select({ cohortId: classSessions.cohortId, n: count() })
      .from(classSessions)
      .where(inArray(classSessions.cohortId, ids))
      .groupBy(classSessions.cohortId);

    const roomSeats = new Map(roomRows.map((r) => [r.id, r.capacity]));
    const tally = (cohortId: string, status: string) =>
      seats.find((s) => s.cohortId === cohortId && s.status === status)?.n ?? 0;

    return rows.map((row) => {
      const capacity = Math.min(row.maxSize, roomSeats.get(row.roomId) ?? row.maxSize);
      const enrolled = tally(row.id, 'active');
      return {
        id: row.id,
        name: row.name,
        courseId: row.courseId,
        intakeId: row.intakeId,
        shiftId: row.shiftId,
        roomId: row.roomId,
        instructorId: row.instructorId,
        branchId: row.branchId,
        startDate: row.startDate,
        endDate: row.endDate,
        maxSize: row.maxSize,
        capacity,
        enrolledCount: enrolled,
        waitlistCount: tally(row.id, 'waitlisted'),
        seatsLeft: Math.max(capacity - enrolled, 0),
        sessionCount: sessionCounts.find((s) => s.cohortId === row.id)?.n ?? 0,
        status: row.status,
        version: row.version,
      };
    });
  }

  async list(query: CohortListQuery, grants: readonly Grant[]): Promise<CohortListResponse> {
    const reach = branchReach(grants, 'cohorts.read');
    const conditions: (SQL | undefined)[] = [
      query.courseId ? eq(cohorts.courseId, query.courseId) : undefined,
      query.status ? eq(cohorts.status, query.status) : undefined,
      query.branchId ? eq(cohorts.branchId, query.branchId) : undefined,
      reach === 'all'
        ? undefined
        : inArray(cohorts.branchId, reach.length > 0 ? reach : [NO_BRANCH]),
    ];
    if (query.stage) {
      const live = ['planned', 'open', 'running'] as const;
      conditions.push(
        query.stage === 'live'
          ? inArray(cohorts.status, live)
          : inArray(cohorts.status, ['completed', 'cancelled']),
      );
    }
    if (query.cursor) {
      const [startDate, id] = decodeCursor(query.cursor, 2);
      conditions.push(
        afterCursor([cohorts.startDate, cohorts.id], [String(startDate), String(id)], 'desc'),
      );
    }

    const rows = await this.db
      .select()
      .from(cohorts)
      .where(and(...conditions))
      .orderBy(desc(cohorts.startDate), desc(cohorts.id))
      .limit(query.limit + 1);
    const page = toPage(rows, query.limit, (r) => [r.startDate, r.id]);
    return { items: await this.withNumbers(page.items), nextCursor: page.nextCursor };
  }

  /** The row for other services in this module; `forUpdate` takes the seat lock. */
  async row(id: string, options: { forUpdate?: boolean } = {}): Promise<CohortRow> {
    const query = this.db.select().from(cohorts).where(eq(cohorts.id, id));
    const [row] = options.forUpdate ? await query.for('update') : await query;
    if (!row) throw cohortErrors.cohortNotFound();
    return row;
  }

  async get(id: string, grants: readonly Grant[]): Promise<Cohort> {
    const row = await this.row(id);
    assertBranchAccess(grants, 'cohorts.read', row.branchId);
    const [cohort] = await this.withNumbers([row]);
    if (!cohort) throw cohortErrors.cohortNotFound();
    return cohort;
  }

  async sessions(id: string, grants: readonly Grant[]): Promise<ClassSession[]> {
    const row = await this.row(id);
    assertBranchAccess(grants, 'cohorts.read', row.branchId);
    const rowsOut = await this.db
      .select()
      .from(classSessions)
      .where(eq(classSessions.cohortId, id))
      .orderBy(asc(classSessions.startsAt));
    return rowsOut.map(toSession);
  }

  async instructors(): Promise<{ id: string; displayName: string }[]> {
    return this.access.activeUsersWithRole('instructor');
  }

  // --- writing -------------------------------------------------------------------------------

  /** Everything a cohort points at must exist and be in use; returns what scope checks need. */
  private async resolve(input: {
    courseId: string;
    shiftId: string;
    roomId: string;
    intakeId: string | null;
    instructorId: string | null;
  }) {
    const course = await this.courses.findWithDepartment(input.courseId);
    if (!course?.course.isActive) throw cohortErrors.referenceNotFound('course');
    const shift = await this.facilities.findShift(input.shiftId);
    if (!shift?.isActive) throw cohortErrors.referenceNotFound('shift');
    const room = await this.facilities.findRoom(input.roomId);
    if (!room?.isActive) throw cohortErrors.referenceNotFound('room');
    if (input.intakeId && !(await this.calendar.intakeExists(input.intakeId))) {
      throw cohortErrors.referenceNotFound('intake');
    }
    if (input.instructorId) {
      const instructors = await this.access.activeUsersWithRole('instructor');
      if (!instructors.some((i) => i.id === input.instructorId))
        throw cohortErrors.notAnInstructor();
    }
    return { course, shift, room };
  }

  /**
   * Replace the cohort's sessions with ones generated from its shift and dates. The EXCLUDE
   * constraints reject a clash, and the failing constraint tells us whether it was the room or
   * the instructor.
   */
  private async generateSessions(cohort: {
    id: string;
    roomId: string;
    instructorId: string | null;
    branchId: string;
    startDate: string;
    endDate: string;
    shift: { daysOfWeek: number[]; startTime: string; endTime: string };
  }): Promise<number> {
    const holidays = await this.calendar.listHolidays();
    const dates = sessionDates({
      startDate: cohort.startDate,
      endDate: cohort.endDate,
      daysOfWeek: cohort.shift.daysOfWeek,
      branchId: cohort.branchId,
      holidays,
    });
    if (dates.length === 0) throw cohortErrors.noSessions();
    if (dates.length > MAX_SESSIONS) throw cohortErrors.tooManySessions();

    const { timezone } = await this.institution.row();
    await this.db.delete(classSessions).where(eq(classSessions.cohortId, cohort.id));
    try {
      // The clock times are wall-clock times at the institution, turned into instants in SQL.
      await this.db.execute(sql`
        INSERT INTO class_sessions (cohort_id, room_id, instructor_id, session_date, starts_at, ends_at)
        SELECT ${cohort.id}::uuid, ${cohort.roomId}::uuid, ${cohort.instructorId}::uuid, d,
               (d + ${cohort.shift.startTime}::time) AT TIME ZONE ${timezone},
               (d + ${cohort.shift.endTime}::time) AT TIME ZONE ${timezone}
        FROM unnest(ARRAY[${sql.join(
          dates.map((day) => sql`${day}`),
          sql`, `,
        )}]::date[]) AS d
      `);
    } catch (error) {
      if (isExclusionViolation(error)) {
        throw constraintName(error)?.includes('instructor')
          ? cohortErrors.instructorConflict()
          : cohortErrors.roomConflict();
      }
      throw error;
    }
    return dates.length;
  }

  @Transactional()
  async create(input: CreateCohortValues, grants: readonly Grant[], actor: Actor): Promise<Cohort> {
    const { course, shift, room } = await this.resolve(input);
    assertScope(grants, 'cohorts.manage', {
      departmentId: course.departmentId,
      branchId: room.branchId,
    });

    const [row] = await this.db
      .insert(cohorts)
      .values({
        ...input,
        branchId: room.branchId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    if (!row) throw cohortErrors.cohortNotFound();
    const sessionCount = await this.generateSessions({ ...row, shift });

    await this.audit.record({
      action: 'cohort.created',
      entityType: 'cohort',
      entityId: row.id,
      changes: {
        name: row.name,
        courseId: row.courseId,
        roomId: row.roomId,
        sessions: sessionCount,
      },
    });
    return this.get(row.id, grants);
  }

  @Transactional()
  async update(
    id: string,
    input: UpdateCohortValues,
    expectedVersion: number,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Cohort> {
    // Locked so the seat count can't change under us while we check it.
    const before = await this.row(id, { forUpdate: true });
    const course = await this.courses.findWithDepartment(before.courseId);
    assertScope(grants, 'cohorts.manage', {
      departmentId: course?.departmentId,
      branchId: before.branchId,
    });
    if (before.status === 'completed' || before.status === 'cancelled') {
      throw cohortErrors.scheduleLocked();
    }

    const changesSchedule = SCHEDULE_FIELDS.some(
      (f) => input[f] !== undefined && input[f] !== before[f],
    );
    if (changesSchedule && before.status === 'running') throw cohortErrors.scheduleLocked();

    const merged = {
      courseId: before.courseId,
      shiftId: input.shiftId ?? before.shiftId,
      roomId: input.roomId ?? before.roomId,
      intakeId: input.intakeId === undefined ? before.intakeId : input.intakeId,
      instructorId: input.instructorId === undefined ? before.instructorId : input.instructorId,
    };
    const { shift, room } = await this.resolve(merged);
    if (room.branchId !== before.branchId) {
      // Moving to another branch's room: the caller needs rights there too.
      assertScope(grants, 'cohorts.manage', {
        departmentId: course?.departmentId,
        branchId: room.branchId,
      });
    }

    const maxSize = input.maxSize ?? before.maxSize;
    const [{ enrolled = 0 } = {}] = await this.db
      .select({ enrolled: count() })
      .from(enrollments)
      .where(and(eq(enrollments.cohortId, id), eq(enrollments.status, 'active')));
    if (Math.min(maxSize, room.capacity) < enrolled) throw cohortErrors.capacityBelowEnrolled();

    const row = versionedRow(
      await updateWithVersion(this.db, cohorts, id, expectedVersion, {
        ...input,
        branchId: room.branchId,
        updatedBy: actor.userId,
      }),
      cohortErrors.cohortNotFound,
    );
    if (changesSchedule) await this.generateSessions({ ...row, shift });

    await this.audit.record({
      action: 'cohort.updated',
      entityType: 'cohort',
      entityId: id,
      changes: {
        name: before.name,
        fields: Object.keys(input).filter(
          (k) => input[k as keyof UpdateCohortValues] !== undefined,
        ),
        rescheduled: changesSchedule,
      },
    });
    return this.get(id, grants);
  }

  /** Open, start, finish or cancel. Cancelling or finishing needs everyone dealt with first. */
  @Transactional()
  async setStatus(
    id: string,
    to: CohortStatus,
    expectedVersion: number,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Cohort> {
    const before = await this.row(id, { forUpdate: true });
    const course = await this.courses.findWithDepartment(before.courseId);
    assertScope(grants, 'cohorts.manage', {
      departmentId: course?.departmentId,
      branchId: before.branchId,
    });
    if (!COHORT_TRANSITIONS[before.status].includes(to)) {
      throw cohortErrors.invalidTransition(before.status, to);
    }

    if (to === 'cancelled' || to === 'completed') {
      const [{ live = 0 } = {}] = await this.db
        .select({ live: count() })
        .from(enrollments)
        .where(
          and(
            eq(enrollments.cohortId, id),
            inArray(enrollments.status, to === 'cancelled' ? ['active', 'waitlisted'] : ['active']),
          ),
        );
      if (live > 0) {
        throw cohortErrors.hasEnrollments(
          to === 'cancelled'
            ? 'Withdraw or move them before cancelling.'
            : 'Record their results before finishing the cohort.',
        );
      }
    }

    const row = versionedRow(
      await updateWithVersion(this.db, cohorts, id, expectedVersion, {
        status: to,
        updatedBy: actor.userId,
      }),
      cohortErrors.cohortNotFound,
    );
    // A cancelled cohort frees its room and instructor.
    if (to === 'cancelled') {
      await this.db.delete(classSessions).where(eq(classSessions.cohortId, id));
    }
    await this.audit.record({
      action: 'cohort.status_changed',
      entityType: 'cohort',
      entityId: id,
      changes: { name: row.name, status: { from: before.status, to } },
    });
    return this.get(id, grants);
  }
}
