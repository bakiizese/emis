import type {
  Application,
  ApplicationListQuery,
  ApplicationListResponse,
  ApplicationStatus,
  ConvertResponse,
  ConvertValues,
  CreateApplicationValues,
  DuplicateCandidate,
  PlacementValues,
  UpdateApplicationValues,
} from '@emis/contracts';
import { afterCursor, applications, decodeCursor, toPage, updateWithVersion } from '@emis/db';
import type { Grant } from '@emis/permissions';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, notInArray, or, type SQL } from 'drizzle-orm';

import { assertBranchAccess, assertScope, branchReach } from '../../../common/authz/scope.js';
import { escapeLike, phonePattern, searchTokens } from '../../../common/db/like.js';
import { versionedRow } from '../../../common/http/versioning.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService } from '../../audit/index.js';
import { CalendarService, CoursesService, FacilitiesService } from '../../catalog/index.js';
import {
  CustomFieldsService,
  DescriptorsService,
  ModulesService,
  NumberingService,
  OrganizationService,
} from '../../settings/index.js';
import { DuplicatesService, StudentsService } from '../../students/index.js';
import { admissionsErrors } from '../domain/errors.js';
import { canPlace, canTransition, CLOSED_STATUSES, isClosed } from '../domain/pipeline.js';

type ApplicationRow = typeof applications.$inferSelect;

const toApplication = (row: ApplicationRow): Application => ({
  id: row.id,
  reference: row.reference,
  status: row.status,
  givenName: row.givenName,
  fatherName: row.fatherName,
  grandfatherName: row.grandfatherName,
  gender: row.gender as Application['gender'],
  dateOfBirth: row.dateOfBirth,
  phone: row.phone,
  email: row.email,
  address: row.address,
  city: row.city,
  branchId: row.branchId,
  source: row.source,
  desiredCourseId: row.desiredCourseId,
  preferredShiftId: row.preferredShiftId,
  preferredIntakeId: row.preferredIntakeId,
  notes: row.notes,
  customFields: row.customFields,
  placement:
    row.placementScore !== null && row.placementCourseId !== null && row.placedAt !== null
      ? {
          score: row.placementScore,
          recommendedCourseId: row.placementCourseId,
          notes: row.placementNotes,
          placedAt: row.placedAt.toISOString(),
        }
      : null,
  studentId: row.studentId,
  createdAt: row.createdAt.toISOString(),
  version: row.version,
});

/** A UUID nobody has: a caller with no branch access matches no rows. */
const NO_BRANCH = '00000000-0000-0000-0000-000000000000';

/**
 * Applications from first contact to enrollment. The stages are a small state machine (see
 * APPLICATION_TRANSITIONS): `placed` comes from recording a placement, `confirmed` from
 * registering the applicant as a student, and everything else from the transition endpoint.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly org: OrganizationService,
    private readonly descriptors: DescriptorsService,
    private readonly customFields: CustomFieldsService,
    private readonly numbering: NumberingService,
    private readonly modules: ModulesService,
    private readonly courses: CoursesService,
    private readonly shifts: FacilitiesService,
    private readonly intakes: CalendarService,
    private readonly students: StudentsService,
    private readonly duplicates: DuplicatesService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  async list(
    query: ApplicationListQuery,
    grants: readonly Grant[],
  ): Promise<ApplicationListResponse> {
    const reach = branchReach(grants, 'admissions.read');
    const conditions: (SQL | undefined)[] = [
      query.status ? eq(applications.status, query.status) : undefined,
      query.branchId ? eq(applications.branchId, query.branchId) : undefined,
      reach === 'all'
        ? undefined
        : inArray(applications.branchId, reach.length > 0 ? reach : [NO_BRANCH]),
    ];
    if (query.stage) {
      conditions.push(
        query.stage === 'closed'
          ? inArray(applications.status, CLOSED_STATUSES)
          : notInArray(applications.status, CLOSED_STATUSES),
      );
    }
    for (const token of searchTokens(query.q ?? '')) {
      const pattern = `%${escapeLike(token)}%`;
      const phone = phonePattern(token);
      conditions.push(
        or(
          ilike(applications.givenName, pattern),
          ilike(applications.fatherName, pattern),
          ilike(applications.grandfatherName, pattern),
          ilike(applications.reference, pattern),
          phone ? ilike(applications.phone, phone) : undefined,
        ),
      );
    }
    if (query.cursor) {
      const [createdAt, id] = decodeCursor(query.cursor, 2);
      conditions.push(
        afterCursor(
          [applications.createdAt, applications.id],
          [String(createdAt), String(id)],
          'desc',
        ),
      );
    }

    const rows = await this.db
      .select()
      .from(applications)
      .where(and(...conditions))
      .orderBy(desc(applications.createdAt), desc(applications.id))
      .limit(query.limit + 1);
    const page = toPage(rows, query.limit, (r) => [r.createdAt.toISOString(), r.id]);
    return { items: page.items.map(toApplication), nextCursor: page.nextCursor };
  }

  private async row(id: string, options: { forUpdate?: boolean } = {}): Promise<ApplicationRow> {
    const query = this.db.select().from(applications).where(eq(applications.id, id));
    const [row] = options.forUpdate ? await query.for('update') : await query;
    if (!row) throw admissionsErrors.notFound();
    return row;
  }

  async get(id: string, grants: readonly Grant[]): Promise<Application> {
    const row = await this.row(id);
    assertBranchAccess(grants, 'admissions.read', row.branchId);
    return toApplication(row);
  }

  /** Students who may be this applicant, so staff can link instead of registering someone twice. */
  async findDuplicates(id: string, grants: readonly Grant[]): Promise<DuplicateCandidate[]> {
    const row = await this.row(id);
    assertBranchAccess(grants, 'admissions.read', row.branchId);
    return this.duplicates.find(row);
  }

  /** Course, shift and intake ids must point at something real (422, not a database error). */
  private async checkReferences(input: {
    desiredCourseId?: string | null;
    preferredShiftId?: string | null;
    preferredIntakeId?: string | null;
  }): Promise<void> {
    if (input.desiredCourseId && !(await this.courses.findWithDepartment(input.desiredCourseId))) {
      throw admissionsErrors.referenceNotFound('course');
    }
    if (input.preferredShiftId && !(await this.shifts.shiftExists(input.preferredShiftId))) {
      throw admissionsErrors.referenceNotFound('shift');
    }
    if (input.preferredIntakeId && !(await this.intakes.intakeExists(input.preferredIntakeId))) {
      throw admissionsErrors.referenceNotFound('intake');
    }
  }

  @Transactional()
  async create(
    input: CreateApplicationValues,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Application> {
    assertScope(grants, 'admissions.manage', { branchId: input.branchId });
    if (!(await this.org.isActiveUnit('branch', input.branchId))) {
      throw admissionsErrors.branchNotFound();
    }
    await this.descriptors.assertActiveCode('lead_source', input.source);
    await this.checkReferences(input);
    const customFields = await this.customFields.validateValues('application', input.customFields);

    const { number } = await this.numbering.next('application');
    const [row] = await this.db
      .insert(applications)
      .values({
        ...input,
        customFields,
        reference: number,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    if (!row) throw admissionsErrors.notFound();

    await this.audit.record({
      action: 'application.created',
      entityType: 'application',
      entityId: row.id,
      changes: { reference: row.reference, branchId: row.branchId, source: row.source },
    });
    return toApplication(row);
  }

  @Transactional()
  async update(
    id: string,
    input: UpdateApplicationValues,
    expectedVersion: number,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Application> {
    const before = await this.row(id);
    assertScope(grants, 'admissions.manage', { branchId: before.branchId });
    if (isClosed(before.status)) throw admissionsErrors.closed();

    if (input.source !== undefined && input.source !== before.source) {
      await this.descriptors.assertActiveCode('lead_source', input.source);
    }
    await this.checkReferences(input);
    const customFields =
      input.customFields === undefined
        ? undefined
        : await this.customFields.validateValues('application', input.customFields);

    const row = versionedRow(
      await updateWithVersion(this.db, applications, id, expectedVersion, {
        ...input,
        customFields,
        updatedBy: actor.userId,
      }),
      admissionsErrors.notFound,
    );
    await this.audit.record({
      action: 'application.updated',
      entityType: 'application',
      entityId: id,
      // Which fields changed, never their values.
      changes: {
        reference: before.reference,
        fields: Object.keys(input).filter(
          (k) => input[k as keyof UpdateApplicationValues] !== undefined,
        ),
      },
    });
    return toApplication(row);
  }

  /** Move to a stage a person may choose (contacted, offered, rejected…). */
  @Transactional()
  async transition(
    id: string,
    to: ApplicationStatus,
    expectedVersion: number,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Application> {
    const before = await this.row(id);
    assertScope(grants, 'admissions.manage', { branchId: before.branchId });
    if (!canTransition(before.status, to))
      throw admissionsErrors.invalidTransition(before.status, to);
    if (to === 'placement_scheduled' && !(await this.modules.isEnabled('placement'))) {
      throw admissionsErrors.placementDisabled();
    }

    const row = versionedRow(
      await updateWithVersion(this.db, applications, id, expectedVersion, {
        status: to,
        updatedBy: actor.userId,
      }),
      admissionsErrors.notFound,
    );
    await this.audit.record({
      action: 'application.status_changed',
      entityType: 'application',
      entityId: id,
      changes: { reference: before.reference, status: { from: before.status, to } },
    });
    return toApplication(row);
  }

  /**
   * Record the placement result and the level to start at, which moves the application to
   * `placed`. Recording again (a retest) replaces the result. The recommended course's department
   * decides who may do it, so a Coordinator places only into their own department's courses.
   */
  @Transactional()
  async recordPlacement(
    id: string,
    input: PlacementValues,
    expectedVersion: number,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<Application> {
    const before = await this.row(id);
    if (!(await this.modules.isEnabled('placement'))) throw admissionsErrors.placementDisabled();
    if (!canPlace(before.status)) throw admissionsErrors.placementNotAllowed();

    const target = await this.courses.findWithDepartment(input.recommendedCourseId);
    if (!target?.course.isActive) throw admissionsErrors.referenceNotFound('course');
    // Branch and department are both given, so a branch-scoped Secretary and a
    // department-scoped Coordinator each pass on their own scope.
    assertScope(grants, 'placement.record', {
      branchId: before.branchId,
      departmentId: target.departmentId,
    });

    const row = versionedRow(
      await updateWithVersion(this.db, applications, id, expectedVersion, {
        status: 'placed',
        placementScore: input.score,
        placementCourseId: input.recommendedCourseId,
        placementNotes: input.notes,
        placedAt: new Date(),
        updatedBy: actor.userId,
      }),
      admissionsErrors.notFound,
    );
    await this.audit.record({
      action: 'application.placed',
      entityType: 'application',
      entityId: id,
      changes: {
        reference: before.reference,
        score: input.score,
        recommendedCourseId: input.recommendedCourseId,
        status: { from: before.status, to: 'placed' },
      },
    });
    return toApplication(row);
  }

  /**
   * Register an offered applicant as a student (or link them to a student who already exists),
   * which confirms the application. The row is locked first so a double click can't register two.
   * If the person looks like an existing student the call is refused until it's confirmed.
   */
  @Transactional()
  async convert(
    id: string,
    input: ConvertValues,
    expectedVersion: number,
    grants: readonly Grant[],
    actor: Actor,
  ): Promise<ConvertResponse> {
    const before = await this.row(id, { forUpdate: true });
    assertScope(grants, 'admissions.manage', { branchId: before.branchId });
    if (before.studentId) throw admissionsErrors.alreadyConverted();
    if (before.status !== 'offered') throw admissionsErrors.notReadyToConvert();

    let studentId: string;
    if (input.existingStudentId) {
      studentId = (await this.students.requireExisting(input.existingStudentId)).id;
    } else {
      const created = await this.students.create(
        {
          givenName: before.givenName,
          fatherName: before.fatherName,
          grandfatherName: before.grandfatherName,
          gender: before.gender as Application['gender'],
          dateOfBirth: before.dateOfBirth,
          phone: before.phone,
          email: before.email,
          address: before.address,
          city: before.city,
          branchId: before.branchId,
          categoryCode: input.categoryCode,
          customFields: input.customFields,
          guardians: [],
          confirmNotDuplicate: input.confirmNotDuplicate,
        },
        grants,
        actor,
      );
      studentId = created.id;
    }

    const row = versionedRow(
      await updateWithVersion(this.db, applications, id, expectedVersion, {
        status: 'confirmed',
        studentId,
        updatedBy: actor.userId,
      }),
      admissionsErrors.notFound,
    );
    const student = await this.students.get(studentId, grants);
    await this.audit.record({
      action: 'application.converted',
      entityType: 'application',
      entityId: id,
      changes: {
        reference: before.reference,
        studentNumber: student.studentNumber,
        linkedExisting: input.existingStudentId !== null,
      },
    });
    return { application: toApplication(row), student };
  }
}
