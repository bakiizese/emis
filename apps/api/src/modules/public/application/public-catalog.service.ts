import type {
  Cohort,
  Course,
  PublicCatalogResponse,
  PublicClass,
  PublicContact,
  PublicCourseDetail,
} from '@emis/contracts';
import { Injectable } from '@nestjs/common';

import { CoursesService, FacilitiesService, ProgramsService } from '../../catalog/index.js';
import { CohortsService } from '../../cohorts/index.js';
import { InstitutionService, OrganizationService } from '../../settings/index.js';
import { publicErrors } from '../domain/errors.js';

const publicCourse = (c: Course) => ({
  id: c.id,
  code: c.code,
  name: c.name,
  levelOrder: c.levelOrder,
  durationWeeks: c.durationWeeks,
  totalHours: c.totalHours,
  certificateEligible: c.certificateEligible,
});

/**
 * What anyone on the internet may see of the catalog: published programs, active courses, classes
 * that can still be joined and how many seats they have left. Nothing else leaves through here
 * (no headcounts, waitlists, prerequisites' ids, fees or staff).
 */
@Injectable()
export class PublicCatalogService {
  constructor(
    private readonly org: OrganizationService,
    private readonly programs: ProgramsService,
    private readonly courses: CoursesService,
    private readonly facilities: FacilitiesService,
    private readonly cohorts: CohortsService,
    private readonly institution: InstitutionService,
  ) {}

  async catalog(): Promise<PublicCatalogResponse> {
    const departments = (await this.org.listDepartments()).filter((d) => d.isActive);
    const programs = (await this.programs.list({})).filter((p) => p.isPublished);
    const courses = await this.courses.listActiveIn(programs.map((p) => p.id));

    return {
      departments: departments
        .map((department) => ({
          id: department.id,
          code: department.code,
          name: department.name,
          description: department.description,
          programs: programs
            .filter((p) => p.departmentId === department.id)
            .map((program) => ({
              id: program.id,
              code: program.code,
              name: program.name,
              type: program.type,
              description: program.description,
              courses: courses.filter((c) => c.programId === program.id).map(publicCourse),
            }))
            .filter((program) => program.courses.length > 0),
        }))
        .filter((department) => department.programs.length > 0),
    };
  }

  /** A course that is on the public catalog, with where it sits, or a 404. */
  private async visibleCourse(id: string) {
    const found = await this.courses.findWithDepartment(id);
    if (!found?.course.isActive) throw publicErrors.courseNotFound();
    const program = await this.programs.get(found.course.programId);
    const department = await this.org.getDepartment(found.departmentId);
    if (!program.isPublished || !department.isActive) throw publicErrors.courseNotFound();
    return { course: found.course, program, department };
  }

  async courseDetail(id: string): Promise<PublicCourseDetail> {
    const { course, program, department } = await this.visibleCourse(id);
    return {
      course: publicCourse(course),
      program: {
        id: program.id,
        code: program.code,
        name: program.name,
        type: program.type,
        description: program.description,
      },
      department: { id: department.id, code: department.code, name: department.name },
      classes: await this.classesOf(course.id),
    };
  }

  /** Soonest joinable classes across the public catalog. */
  async upcoming(limit: number): Promise<PublicClass[]> {
    const catalog = await this.catalog();
    const visible = new Set(
      catalog.departments.flatMap((d) => d.programs.flatMap((p) => p.courses.map((c) => c.id))),
    );
    const today = await this.institution.today();
    const joinable = (await this.cohorts.listJoinable({ today })).filter((c) =>
      visible.has(c.courseId),
    );
    const names = new Map(
      catalog.departments.flatMap((d) =>
        d.programs.flatMap((p) => p.courses.map((c) => [c.id, c.name] as const)),
      ),
    );
    return (await this.present(joinable, names)).slice(0, limit);
  }

  private async classesOf(courseId: string): Promise<PublicClass[]> {
    const today = await this.institution.today();
    const joinable = await this.cohorts.listJoinable({ today, courseId });
    const course = await this.courses.get(courseId);
    return this.present(joinable, new Map([[courseId, course.name]]));
  }

  private async present(
    cohorts: Cohort[],
    courseNames: ReadonlyMap<string, string>,
  ): Promise<PublicClass[]> {
    const shifts = new Map((await this.facilities.listShifts()).map((s) => [s.id, s]));
    const branches = new Map((await this.org.listBranches()).map((b) => [b.id, b]));
    const items: PublicClass[] = [];
    for (const cohort of cohorts) {
      const shift = shifts.get(cohort.shiftId);
      const branch = branches.get(cohort.branchId);
      if (!shift || !branch || !branch.isActive) continue;
      items.push({
        id: cohort.id,
        name: cohort.name,
        courseId: cohort.courseId,
        courseName: courseNames.get(cohort.courseId) ?? '',
        intakeId: cohort.intakeId,
        shift: {
          id: shift.id,
          name: shift.name,
          daysOfWeek: shift.daysOfWeek,
          startTime: shift.startTime,
          endTime: shift.endTime,
        },
        branch: { id: branch.id, name: branch.name, address: branch.address, phone: branch.phone },
        startDate: cohort.startDate,
        endDate: cohort.endDate,
        seatsLeft: cohort.seatsLeft,
        isFull: cohort.seatsLeft === 0,
      });
    }
    return items;
  }

  async contact(): Promise<PublicContact> {
    const inst = await this.institution.get();
    const branches = (await this.org.listBranches()).filter((b) => b.isActive);
    return {
      name: inst.name,
      email: inst.email,
      phone: inst.phone,
      address: inst.address,
      city: inst.city,
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        address: b.address,
        phone: b.phone,
      })),
    };
  }

  /** The course must be on the public catalog and the shift, if named, in use. */
  async assertPreRegistrable(courseId: string, shiftId: string | null): Promise<string> {
    let course: Course;
    try {
      ({ course } = await this.visibleCourse(courseId));
    } catch {
      throw publicErrors.referenceNotFound('course');
    }
    if (shiftId) {
      const shift = await this.facilities.findShift(shiftId);
      if (!shift?.isActive) throw publicErrors.referenceNotFound('shift');
    }
    return course.name;
  }
}
