import {
  type Enrollment,
  type EnrollmentListQuery,
  type EnrollmentListResponse,
  type EnrollmentStatus,
  ENROLLING_COHORT_STATUSES,
  type EnrollResponse,
  type RecordResultValues,
  type WithdrawResponse,
} from '@emis/contracts';
import {
  afterCursor,
  cohorts,
  decodeCursor,
  enrollments,
  rooms,
  students,
  toPage,
  updateWithVersion,
} from '@emis/db';
import type { Grant } from '@emis/permissions';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, type SQL } from 'drizzle-orm';

import { assertScope, branchReach } from '../../../common/authz/scope.js';
import { isUniqueViolation } from '../../../common/db/errors.js';
import { versionedRow } from '../../../common/http/versioning.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { ApplicationsService } from '../../admissions/index.js';
import { AuditService } from '../../audit/index.js';
import { CoursesService } from '../../catalog/index.js';
import { DescriptorsService } from '../../settings/index.js';
import { StudentsService } from '../../students/index.js';
import { evaluateCompletion } from '../domain/completion.js';
import { cohortErrors } from '../domain/errors.js';
import { CohortsService } from './cohorts.service.js';

type EnrollmentRow = typeof enrollments.$inferSelect;

/** A UUID nobody has: a caller with no branch access matches no rows. */
const NO_BRANCH = '00000000-0000-0000-0000-000000000000';

interface Joined {
  enrollment: EnrollmentRow;
  studentNumber: string;
  studentName: string;
  cohortName: string;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

function toEnrollment(joined: Joined, waitlistPosition: number | null): Enrollment {
  const { enrollment: e } = joined;
  return {
    id: e.id,
    studentId: e.studentId,
    studentName: joined.studentName,
    studentNumber: joined.studentNumber,
    cohortId: e.cohortId,
    cohortName: joined.cohortName,
    status: e.status,
    waitlistPosition: e.status === 'waitlisted' ? waitlistPosition : null,
    enrolledAt: iso(e.enrolledAt),
    withdrawnAt: iso(e.withdrawnAt),
    withdrawalReason: e.withdrawalReason,
    score: e.score,
    attendancePercent: e.attendancePercent,
    completedAt: iso(e.completedAt),
    createdAt: e.createdAt.toISOString(),
    version: e.version,
  };
}

/**
 * Enrollment: seats, the waitlist, withdrawals and results.
 *
 * Every change to a cohort's seats first takes a row lock on that cohort (SELECT ... FOR UPDATE),
 * so however many people enroll or withdraw at once they are handled one after another and the
 * count can't be beaten by a race. The last seat goes to exactly one request; the rest wait
 * their turn on the waitlist, and a freed seat goes to the person who has waited longest.
 */
@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly cohorts: CohortsService,
    private readonly courses: CoursesService,
    private readonly students: StudentsService,
    private readonly applications: ApplicationsService,
    private readonly descriptors: DescriptorsService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  // --- reading -------------------------------------------------------------------------------

  private joinedSelect() {
    return this.db
      .select({
        enrollment: enrollments,
        studentNumber: students.studentNumber,
        givenName: students.givenName,
        fatherName: students.fatherName,
        cohortName: cohorts.name,
        cohortBranchId: cohorts.branchId,
      })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(cohorts, eq(cohorts.id, enrollments.cohortId));
  }

  /** 1-based place in each cohort's waitlist, oldest first, for the cohorts given. */
  private async positions(cohortIds: string[]): Promise<Map<string, number>> {
    const positions = new Map<string, number>();
    if (cohortIds.length === 0) return positions;
    const queue = await this.db
      .select({ id: enrollments.id, cohortId: enrollments.cohortId })
      .from(enrollments)
      .where(and(inArray(enrollments.cohortId, cohortIds), eq(enrollments.status, 'waitlisted')))
      .orderBy(asc(enrollments.waitlistedAt), asc(enrollments.id));
    const next = new Map<string, number>();
    for (const { id, cohortId } of queue) {
      const place = (next.get(cohortId) ?? 0) + 1;
      next.set(cohortId, place);
      positions.set(id, place);
    }
    return positions;
  }

  private async present(ids: string[]): Promise<Enrollment[]> {
    if (ids.length === 0) return [];
    const rows = await this.joinedSelect().where(inArray(enrollments.id, ids));
    const positions = await this.positions([...new Set(rows.map((r) => r.enrollment.cohortId))]);
    const byId = new Map(
      rows.map((r) => [
        r.enrollment.id,
        toEnrollment(
          {
            enrollment: r.enrollment,
            studentNumber: r.studentNumber,
            studentName: `${r.givenName} ${r.fatherName}`,
            cohortName: r.cohortName,
          },
          positions.get(r.enrollment.id) ?? null,
        ),
      ]),
    );
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  async list(
    query: EnrollmentListQuery,
    grants: readonly Grant[],
  ): Promise<EnrollmentListResponse> {
    const reach = branchReach(grants, 'enrollments.read');
    const conditions: (SQL | undefined)[] = [
      query.cohortId ? eq(enrollments.cohortId, query.cohortId) : undefined,
      query.studentId ? eq(enrollments.studentId, query.studentId) : undefined,
      query.status ? eq(enrollments.status, query.status) : undefined,
      reach === 'all'
        ? undefined
        : inArray(cohorts.branchId, reach.length > 0 ? reach : [NO_BRANCH]),
    ];
    if (query.cursor) {
      const [createdAt, id] = decodeCursor(query.cursor, 2);
      conditions.push(
        afterCursor(
          [enrollments.createdAt, enrollments.id],
          [String(createdAt), String(id)],
          'desc',
        ),
      );
    }
    const rows = await this.db
      .select({ id: enrollments.id, createdAt: enrollments.createdAt })
      .from(enrollments)
      .innerJoin(cohorts, eq(cohorts.id, enrollments.cohortId))
      .where(and(...conditions))
      .orderBy(desc(enrollments.createdAt), desc(enrollments.id))
      .limit(query.limit + 1);
    const page = toPage(rows, query.limit, (r) => [r.createdAt.toISOString(), r.id]);
    return { items: await this.present(page.items.map((r) => r.id)), nextCursor: page.nextCursor };
  }

  private async row(id: string): Promise<EnrollmentRow> {
    const [row] = await this.db.select().from(enrollments).where(eq(enrollments.id, id));
    if (!row) throw cohortErrors.enrollmentNotFound();
    return row;
  }

  // --- enrolling -----------------------------------------------------------------------------

  /** The student must have completed every prerequisite course (in any cohort of that course). */
  private async assertPrerequisites(studentId: string, courseId: string): Promise<void> {
    const { prerequisiteIds } = await this.courses.get(courseId);
    if (prerequisiteIds.length === 0) return;
    const done = await this.db
      .selectDistinct({ courseId: cohorts.courseId })
      .from(enrollments)
      .innerJoin(cohorts, eq(cohorts.id, enrollments.cohortId))
      .where(
        and(
          eq(enrollments.studentId, studentId),
          eq(enrollments.status, 'completed'),
          inArray(cohorts.courseId, prerequisiteIds),
        ),
      );
    if (done.length < prerequisiteIds.length) throw cohortErrors.prerequisitesNotMet();
  }

  /** Seats a cohort has: the smaller of its own limit and its room's seats. */
  private async seatsOf(cohort: { roomId: string; maxSize: number }): Promise<number> {
    const [room] = await this.db
      .select({ capacity: rooms.capacity })
      .from(rooms)
      .where(eq(rooms.id, cohort.roomId));
    return Math.min(cohort.maxSize, room?.capacity ?? cohort.maxSize);
  }

  private async activeCount(cohortId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(enrollments)
      .where(and(eq(enrollments.cohortId, cohortId), eq(enrollments.status, 'active')));
    return row?.n ?? 0;
  }

  /**
   * Enroll a student, or put them on the waitlist if the class is full. Idempotent per key at the
   * HTTP layer, and safe under any number of simultaneous callers (see the class comment).
   */
  @Transactional()
  async enroll(
    input: { studentId: string; cohortId: string },
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<EnrollResponse> {
    const cohort = await this.cohorts.row(input.cohortId, { forUpdate: true });
    assertScope(grants, 'enrollments.manage', { branchId: cohort.branchId });
    if (!(ENROLLING_COHORT_STATUSES as readonly string[]).includes(cohort.status)) {
      throw cohortErrors.notEnrolling();
    }

    const student = await this.students.requireExisting(input.studentId);
    if (student.status !== 'active') throw cohortErrors.studentNotActive();

    const [existing] = await this.db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.studentId, input.studentId),
          eq(enrollments.cohortId, input.cohortId),
          inArray(enrollments.status, ['waitlisted', 'active', 'completed']),
        ),
      );
    if (existing) throw cohortErrors.alreadyEnrolled();

    await this.assertPrerequisites(input.studentId, cohort.courseId);

    const hasSeat = (await this.activeCount(cohort.id)) < (await this.seatsOf(cohort));
    const now = new Date();
    let row: EnrollmentRow | undefined;
    try {
      [row] = await this.db
        .insert(enrollments)
        .values({
          studentId: input.studentId,
          cohortId: cohort.id,
          status: hasSeat ? 'active' : 'waitlisted',
          enrolledAt: hasSeat ? now : null,
          waitlistedAt: hasSeat ? null : now,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw cohortErrors.alreadyEnrolled();
      throw error;
    }
    if (!row) throw cohortErrors.enrollmentNotFound();

    if (hasSeat) await this.applications.markEnrolled(input.studentId);
    await this.audit.record({
      action: hasSeat ? 'enrollment.created' : 'enrollment.waitlisted',
      entityType: 'enrollment',
      entityId: row.id,
      changes: { cohortId: cohort.id, studentNumber: student.studentNumber },
    });

    const [enrollment] = await this.present([row.id]);
    if (!enrollment) throw cohortErrors.enrollmentNotFound();
    return { outcome: hasSeat ? 'enrolled' : 'waitlisted', enrollment };
  }

  // --- leaving -------------------------------------------------------------------------------

  /**
   * Withdraw a student (from a seat or from the waitlist). A freed seat goes straight to the
   * student who has waited longest, in the same transaction, so it's never left empty.
   */
  @Transactional()
  async withdraw(
    id: string,
    input: { reasonCode: string },
    expectedVersion: number,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<WithdrawResponse> {
    const found = await this.row(id);
    const cohort = await this.cohorts.row(found.cohortId, { forUpdate: true });
    assertScope(grants, 'enrollments.manage', { branchId: cohort.branchId });
    if (found.status !== 'active' && found.status !== 'waitlisted') {
      throw cohortErrors.invalidEnrollmentState(
        'Only students who are enrolled or waiting can withdraw.',
      );
    }
    await this.descriptors.assertActiveCode('withdrawal_reason', input.reasonCode);

    const row = versionedRow(
      await updateWithVersion(this.db, enrollments, id, expectedVersion, {
        status: 'withdrawn',
        withdrawnAt: new Date(),
        withdrawalReason: input.reasonCode,
        updatedBy: actor.userId,
      }),
      cohortErrors.enrollmentNotFound,
    );
    await this.audit.record({
      action: 'enrollment.withdrawn',
      entityType: 'enrollment',
      entityId: id,
      changes: {
        cohortId: cohort.id,
        status: { from: found.status, to: 'withdrawn' },
        reason: input.reasonCode,
      },
    });

    const promotedId =
      found.status === 'active' && cohort.status !== 'cancelled'
        ? await this.promoteWaiting(cohort, actor)
        : null;
    const [enrollment] = await this.present([row.id]);
    const [promoted] = promotedId ? await this.present([promotedId]) : [];
    if (!enrollment) throw cohortErrors.enrollmentNotFound();
    return { enrollment, promoted: promoted ?? null };
  }

  /** Give a free seat to the longest-waiting student. The caller holds the cohort lock. */
  private async promoteWaiting(
    cohort: { id: string; roomId: string; maxSize: number },
    actor: Actor,
  ): Promise<string | null> {
    if ((await this.activeCount(cohort.id)) >= (await this.seatsOf(cohort))) return null;
    const [next] = await this.db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.cohortId, cohort.id), eq(enrollments.status, 'waitlisted')))
      .orderBy(asc(enrollments.waitlistedAt), asc(enrollments.id))
      .limit(1);
    if (!next) return null;

    await this.db
      .update(enrollments)
      .set({
        status: 'active',
        enrolledAt: new Date(),
        updatedBy: actor.userId,
        version: next.version + 1,
      })
      .where(eq(enrollments.id, next.id));
    await this.applications.markEnrolled(next.studentId);
    await this.audit.record({
      action: 'enrollment.promoted',
      entityType: 'enrollment',
      entityId: next.id,
      changes: { cohortId: cohort.id, status: { from: 'waitlisted', to: 'active' } },
    });
    return next.id;
  }

  // --- results -------------------------------------------------------------------------------

  /**
   * Record the final result and let the course's completion rules decide: met → completed,
   * missed → failed. A rule that needs a number that wasn't given is refused rather than failed.
   * The course's department decides who may do it.
   */
  @Transactional()
  async recordResult(
    id: string,
    input: RecordResultValues,
    expectedVersion: number,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Enrollment> {
    const found = await this.row(id);
    const cohort = await this.cohorts.row(found.cohortId);
    const course = await this.courses.findWithDepartment(cohort.courseId);
    if (!course) throw cohortErrors.cohortNotFound();
    assertScope(grants, 'results.record', {
      departmentId: course.departmentId,
      branchId: cohort.branchId,
    });
    if (found.status !== 'active') {
      throw cohortErrors.invalidEnrollmentState(
        'Results can only be recorded for students who are enrolled.',
      );
    }

    const outcome = evaluateCompletion(course.course, input);
    if (outcome.kind === 'incomplete') throw cohortErrors.resultIncomplete(outcome.missing);
    const status: EnrollmentStatus = outcome.kind === 'passed' ? 'completed' : 'failed';

    const row = versionedRow(
      await updateWithVersion(this.db, enrollments, id, expectedVersion, {
        status,
        score: input.score,
        attendancePercent: input.attendancePercent,
        completedAt: new Date(),
        updatedBy: actor.userId,
      }),
      cohortErrors.enrollmentNotFound,
    );
    await this.audit.record({
      action: 'enrollment.result_recorded',
      entityType: 'enrollment',
      entityId: id,
      changes: {
        cohortId: cohort.id,
        status: { from: 'active', to: status },
        score: input.score,
        attendancePercent: input.attendancePercent,
      },
    });
    const [enrollment] = await this.present([row.id]);
    if (!enrollment) throw cohortErrors.enrollmentNotFound();
    return enrollment;
  }
}
