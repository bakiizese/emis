import type { Course, CreateCourseRequest, UpdateCourseRequest } from '@emis/contracts';
import { coursePrerequisites, courses, updateWithVersion } from '@emis/db';
import type { Grant } from '@emis/permissions';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { assertScope } from '../../../common/authz/scope.js';
import { isUniqueViolation } from '../../../common/db/errors.js';
import { versionedRow } from '../../../common/http/versioning.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService, diffChanges } from '../../audit/index.js';
import { catalogErrors } from '../domain/errors.js';
import { wouldCreateCycle } from '../domain/prerequisites.js';
import { ProgramsService } from './programs.service.js';

type CourseRow = typeof courses.$inferSelect;

const toCourse = (row: CourseRow, prerequisiteIds: string[]): Course => ({
  id: row.id,
  programId: row.programId,
  code: row.code,
  name: row.name,
  levelOrder: row.levelOrder,
  durationWeeks: row.durationWeeks,
  totalHours: row.totalHours,
  minAttendancePercent: row.minAttendancePercent,
  minScore: row.minScore,
  certificateEligible: row.certificateEligible,
  isActive: row.isActive,
  sortOrder: row.sortOrder,
  prerequisiteIds,
  version: row.version,
});

/**
 * Courses (levels) inside a program, with their prerequisites and completion rules. Scope checks
 * follow the program's department.
 */
@Injectable()
export class CoursesService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly programs: ProgramsService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  /** Prerequisite ids per course, for the given courses. */
  private async prerequisitesOf(courseIds: string[]): Promise<Map<string, string[]>> {
    const byCourse = new Map<string, string[]>();
    if (courseIds.length === 0) return byCourse;
    const rows = await this.db
      .select()
      .from(coursePrerequisites)
      .where(inArray(coursePrerequisites.courseId, courseIds));
    for (const row of rows) {
      byCourse.set(row.courseId, [...(byCourse.get(row.courseId) ?? []), row.prerequisiteCourseId]);
    }
    return byCourse;
  }

  async list(programId: string): Promise<Course[]> {
    const rows = await this.db
      .select()
      .from(courses)
      .where(eq(courses.programId, programId))
      .orderBy(asc(courses.levelOrder), asc(courses.sortOrder), asc(courses.name));
    const prerequisites = await this.prerequisitesOf(rows.map((r) => r.id));
    return rows.map((row) => toCourse(row, prerequisites.get(row.id) ?? []));
  }

  private async row(id: string): Promise<CourseRow> {
    const [row] = await this.db.select().from(courses).where(eq(courses.id, id));
    if (!row) throw catalogErrors.courseNotFound();
    return row;
  }

  async get(id: string): Promise<Course> {
    const row = await this.row(id);
    const prerequisites = await this.prerequisitesOf([id]);
    return toCourse(row, prerequisites.get(id) ?? []);
  }

  @Transactional()
  async create(
    input: Required<CreateCourseRequest>,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Course> {
    const program = await this.programs.row(input.programId).catch(() => {
      throw catalogErrors.programMissing();
    });
    assertScope(grants, 'catalog.manage', { departmentId: program.departmentId });

    let row: CourseRow | undefined;
    try {
      [row] = await this.db
        .insert(courses)
        .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw catalogErrors.codeTaken('course in this program');
      throw error;
    }
    if (!row) throw catalogErrors.courseNotFound();

    await this.audit.record({
      action: 'course.created',
      entityType: 'course',
      entityId: row.id,
      changes: { code: row.code, name: row.name, programId: row.programId },
    });
    return toCourse(row, []);
  }

  @Transactional()
  async update(
    id: string,
    input: UpdateCourseRequest,
    expectedVersion: number,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Course> {
    const before = await this.row(id);
    const program = await this.programs.row(before.programId);
    assertScope(grants, 'catalog.manage', { departmentId: program.departmentId });

    const row = versionedRow(
      await updateWithVersion(this.db, courses, id, expectedVersion, {
        ...input,
        updatedBy: actor.userId,
      }),
      catalogErrors.courseNotFound,
    );
    await this.audit.record({
      action: 'course.updated',
      entityType: 'course',
      entityId: id,
      changes: { code: before.code, ...diffChanges(before, input) },
    });
    const prerequisites = await this.prerequisitesOf([id]);
    return toCourse(row, prerequisites.get(id) ?? []);
  }

  /**
   * Replace the course's prerequisites. They must be other courses in the same program and can't
   * loop back (A needs B needs A), since a loop would make enrollment impossible. The course's
   * version is bumped so two people editing prerequisites at once get a 412, not a silent overwrite.
   */
  @Transactional()
  async setPrerequisites(
    id: string,
    requestedIds: string[],
    expectedVersion: number,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Course> {
    const before = await this.row(id);
    const program = await this.programs.row(before.programId);
    assertScope(grants, 'catalog.manage', { departmentId: program.departmentId });

    // One editor per program at a time: two people setting A→B and B→A together could each pass
    // the loop check against the old data and both commit.
    await this.db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`emis.prerequisites:${before.programId}`}))`,
    );

    const ids = [...new Set(requestedIds)];
    if (ids.includes(id)) throw catalogErrors.crossProgramPrerequisite();
    if (ids.length > 0) {
      const found = await this.db
        .select({ id: courses.id })
        .from(courses)
        .where(and(inArray(courses.id, ids), eq(courses.programId, before.programId)));
      if (found.length !== ids.length) throw catalogErrors.crossProgramPrerequisite();

      const edges = await this.db
        .select()
        .from(coursePrerequisites)
        .innerJoin(courses, eq(courses.id, coursePrerequisites.courseId))
        .where(eq(courses.programId, before.programId));
      const graph: Map<string, string[]> = new Map();
      for (const { course_prerequisites: edge } of edges) {
        graph.set(edge.courseId, [...(graph.get(edge.courseId) ?? []), edge.prerequisiteCourseId]);
      }
      if (wouldCreateCycle(graph, id, ids)) {
        throw catalogErrors.prerequisiteCycle();
      }
    }

    const bumped = versionedRow(
      await updateWithVersion(this.db, courses, id, expectedVersion, { updatedBy: actor.userId }),
      catalogErrors.courseNotFound,
    );
    const currentIds = (await this.prerequisitesOf([id])).get(id) ?? [];
    await this.db.delete(coursePrerequisites).where(eq(coursePrerequisites.courseId, id));
    if (ids.length > 0) {
      await this.db
        .insert(coursePrerequisites)
        .values(ids.map((prerequisiteCourseId) => ({ courseId: id, prerequisiteCourseId })));
    }

    await this.audit.record({
      action: 'course.prerequisites_set',
      entityType: 'course',
      entityId: id,
      changes: { code: before.code, prerequisiteIds: { from: currentIds, to: ids } },
    });
    return toCourse(bumped, ids);
  }
}
