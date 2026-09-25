import { randomUUID } from 'node:crypto';

import {
  academicYearSchema,
  auditListResponseSchema,
  branchSchema,
  courseListResponseSchema,
  courseSchema,
  departmentSchema,
  holidaySchema,
  intakeSchema,
  problemDetailsSchema,
  programListResponseSchema,
  programSchema,
  roomListResponseSchema,
  roomSchema,
  shiftSchema,
} from '@emis/contracts';
import { roles, userRoleAssignments } from '@emis/db';
import { createIsolatedDatabase, type TestDatabaseUrls } from '@emis/db/testing';
import type { Scope } from '@emis/permissions';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { ClsService } from 'nestjs-cls';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { DbAdapter } from '../../database/database.module.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { callAs, createStaff, type StaffFixture } from '../../testing/staff-fixtures.js';

// Own database: a fresh institution with two departments and two branches.
let urls: TestDatabaseUrls;
let app: NestFastifyApplication;
let asAdmin: ReturnType<typeof callAs>;
let asLanguageCoordinator: ReturnType<typeof callAs>;
let asSecretary: ReturnType<typeof callAs>;

let language: { id: string };
let computer: { id: string };
let bole: { id: string };
let piassa: { id: string };

const code = (res: LightMyRequestResponse) => problemDetailsSchema.parse(res.json()).code;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });

async function grantRole(staff: StaffFixture, roleKey: string, scope: Scope) {
  await app.get(ClsService).run(async () => {
    const db = app.get<TransactionHost<DbAdapter>>(TransactionHost).tx;
    const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, roleKey));
    if (!role) throw new Error(`role ${roleKey} missing`);
    await db.insert(userRoleAssignments).values({
      userId: staff.userId,
      roleId: role.id,
      scopeType: scope.type,
      scopeId: scope.type === 'global' ? null : scope.id,
    });
  });
}

async function create<T>(
  who: ReturnType<typeof callAs>,
  url: string,
  payload: object,
  schema: { parse: (v: unknown) => T },
): Promise<T> {
  const res = await who('POST', url, payload);
  expect(res.statusCode, res.body).toBe(201);
  return schema.parse(res.json());
}

beforeAll(async () => {
  urls = await createIsolatedDatabase(inject('database'), 'emis_catalog_test');
  app = await createTestApp({
    env: { DATABASE_URL: urls.appUrl, RATE_LIMIT_MAX: '10000' },
  });
  const admin = await createStaff(app, { email: 'catalog-admin@lingua.test', roleKey: 'admin' });
  asAdmin = callAs(app, admin);

  language = await create(
    asAdmin,
    '/departments',
    { code: 'LANG', name: 'Language' },
    departmentSchema,
  );
  computer = await create(
    asAdmin,
    '/departments',
    { code: 'COMP', name: 'Computer' },
    departmentSchema,
  );
  bole = await create(asAdmin, '/branches', { code: 'BOLE', name: 'Bole' }, branchSchema);
  piassa = await create(asAdmin, '/branches', { code: 'PIAZ', name: 'Piassa' }, branchSchema);

  // A Coordinator limited to the Language department, and a front-desk Secretary.
  const coordinator = await createStaff(app, { email: 'catalog-coord@lingua.test' });
  await grantRole(coordinator, 'coordinator', { type: 'department', id: language.id });
  asLanguageCoordinator = callAs(app, coordinator);
  asSecretary = callAs(
    app,
    await createStaff(app, { email: 'catalog-desk@lingua.test', roleKey: 'secretary' }),
  );
});
afterAll(() => app.close());

describe('programs', () => {
  it('creates a program and rejects a duplicate code', async () => {
    const program = await create(
      asAdmin,
      '/programs',
      { departmentId: language.id, code: 'genl', name: 'General English', type: 'long_course' },
      programSchema,
    );
    expect(program).toMatchObject({ code: 'GENL', isPublished: false, version: 1 });

    const dup = await asAdmin('POST', '/programs', {
      departmentId: computer.id,
      code: 'GENL',
      name: 'Another',
      type: 'short_course',
    });
    expect(dup.statusCode).toBe(409);
    expect(code(dup)).toBe('CODE_TAKEN');
  });

  it('needs an existing, active department', async () => {
    const missing = await asAdmin('POST', '/programs', {
      departmentId: '0199a1b2-0000-7000-8000-000000000000',
      code: 'NOPE',
      name: 'Nowhere',
      type: 'short_course',
    });
    expect(missing.statusCode).toBe(422);
    expect(code(missing)).toBe('DEPARTMENT_NOT_FOUND');
  });

  it('replays a retried create instead of making two programs', async () => {
    const key = randomUUID();
    const body = {
      departmentId: computer.id,
      code: 'WEB',
      name: 'Web Development',
      type: 'long_course',
    };
    const first = await asAdmin('POST', '/programs', body, { 'idempotency-key': key });
    const second = await asAdmin('POST', '/programs', body, { 'idempotency-key': key });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    const list = programListResponseSchema.parse(
      (await asAdmin('GET', `/programs?departmentId=${computer.id}`)).json(),
    );
    expect(list.items.filter((p) => p.code === 'WEB')).toHaveLength(1);
  });

  it('keeps a Coordinator inside their own department', async () => {
    const own = await asLanguageCoordinator('POST', '/programs', {
      departmentId: language.id,
      code: 'IELTS',
      name: 'IELTS Preparation',
      type: 'exam_prep',
    });
    expect(own.statusCode).toBe(201);

    const other = await asLanguageCoordinator('POST', '/programs', {
      departmentId: computer.id,
      code: 'PYTH',
      name: 'Python',
      type: 'short_course',
    });
    expect(other.statusCode).toBe(403);
    expect(code(other)).toBe('PERMISSION_DENIED');

    // Editing: their own program yes, another department's no.
    const ownProgram = programSchema.parse(own.json());
    const edited = await asLanguageCoordinator(
      'PATCH',
      `/programs/${ownProgram.id}`,
      { isPublished: true },
      ifMatch(ownProgram.version),
    );
    expect(edited.statusCode).toBe(200);
    expect(programSchema.parse(edited.json())).toMatchObject({ isPublished: true, version: 2 });

    const web = programListResponseSchema
      .parse((await asAdmin('GET', '/programs')).json())
      .items.find((p) => p.code === 'WEB');
    const denied = await asLanguageCoordinator(
      'PATCH',
      `/programs/${web?.id}`,
      { isPublished: true },
      ifMatch(web?.version ?? 1),
    );
    expect(denied.statusCode).toBe(403);
  });

  it('lets front-desk staff read but not change', async () => {
    expect((await asSecretary('GET', '/programs')).statusCode).toBe(200);
    const res = await asSecretary('POST', '/programs', {
      departmentId: language.id,
      code: 'DESK',
      name: 'Desk program',
      type: 'short_course',
    });
    expect(res.statusCode).toBe(403);
  });

  it('needs If-Match and rejects a stale version', async () => {
    const [program] = programListResponseSchema.parse(
      (await asAdmin('GET', '/programs')).json(),
    ).items;
    expect(
      (await asAdmin('PATCH', `/programs/${program?.id}`, { name: 'Renamed' })).statusCode,
    ).toBe(428);
    const stale = await asAdmin(
      'PATCH',
      `/programs/${program?.id}`,
      { name: 'Renamed' },
      ifMatch((program?.version ?? 1) + 5),
    );
    expect(stale.statusCode).toBe(412);
  });
});

describe('courses and prerequisites', () => {
  let programId: string;
  let otherProgramId: string;
  const course = (id: string) =>
    asAdmin('GET', `/courses/${id}`).then((r) => courseSchema.parse(r.json()));

  beforeAll(async () => {
    programId = (
      await create(
        asAdmin,
        '/programs',
        { departmentId: language.id, code: 'ENGB', name: 'English by level', type: 'long_course' },
        programSchema,
      )
    ).id;
    otherProgramId = (
      await create(
        asAdmin,
        '/programs',
        { departmentId: language.id, code: 'FREN', name: 'French', type: 'long_course' },
        programSchema,
      )
    ).id;
  });

  const make = (programId: string, courseCode: string, levelOrder: number, extra: object = {}) =>
    create(
      asAdmin,
      '/courses',
      { programId, code: courseCode, name: `Level ${courseCode}`, levelOrder, ...extra },
      courseSchema,
    );

  it('stores completion rules and lists courses in level order', async () => {
    await make(programId, 'A2', 2, { minAttendancePercent: 80, minScore: 60, totalHours: 60 });
    await make(programId, 'A1', 1);
    const list = courseListResponseSchema.parse(
      (await asAdmin('GET', `/courses?programId=${programId}`)).json(),
    );
    expect(list.items.map((c) => c.code)).toEqual(['A1', 'A2']);
    expect(list.items[1]).toMatchObject({
      minAttendancePercent: 80,
      minScore: 60,
      totalHours: 60,
      certificateEligible: true,
      prerequisiteIds: [],
    });
  });

  it('allows the same code in another program but not twice in one', async () => {
    expect((await make(otherProgramId, 'A1', 1)).code).toBe('A1');
    const dup = await asAdmin('POST', '/courses', {
      programId,
      code: 'A1',
      name: 'Again',
    });
    expect(dup.statusCode).toBe(409);
    expect(code(dup)).toBe('CODE_TAKEN');
  });

  it('rejects a course for a program that does not exist', async () => {
    const res = await asAdmin('POST', '/courses', {
      programId: '0199a1b2-0000-7000-8000-000000000000',
      code: 'X1',
      name: 'Orphan',
    });
    expect(res.statusCode).toBe(422);
    expect(code(res)).toBe('PROGRAM_NOT_FOUND');
  });

  it('updates rules with the version and can clear one', async () => {
    const list = courseListResponseSchema.parse(
      (await asAdmin('GET', `/courses?programId=${programId}`)).json(),
    );
    const a2 = list.items.find((c) => c.code === 'A2');
    const res = await asAdmin(
      'PATCH',
      `/courses/${a2?.id}`,
      { minScore: null, certificateEligible: false },
      ifMatch(a2?.version ?? 1),
    );
    expect(courseSchema.parse(res.json())).toMatchObject({
      minScore: null,
      minAttendancePercent: 80,
      certificateEligible: false,
      version: 2,
    });
  });

  it('sets prerequisites, replaces them, and bumps the version', async () => {
    const b1 = await make(programId, 'B1', 3);
    const list = courseListResponseSchema.parse(
      (await asAdmin('GET', `/courses?programId=${programId}`)).json(),
    );
    const a1 = list.items.find((c) => c.code === 'A1');
    const a2 = list.items.find((c) => c.code === 'A2');

    const set = await asAdmin(
      'PUT',
      `/courses/${b1.id}/prerequisites`,
      { courseIds: [a1?.id, a2?.id] },
      ifMatch(b1.version),
    );
    expect(set.statusCode, set.body).toBe(200);
    const updated = courseSchema.parse(set.json());
    expect([...updated.prerequisiteIds].sort()).toEqual([a1?.id, a2?.id].sort());
    expect(updated.version).toBe(b1.version + 1);

    // Replacing keeps only what's listed.
    const replaced = await asAdmin(
      'PUT',
      `/courses/${b1.id}/prerequisites`,
      { courseIds: [a2?.id] },
      ifMatch(updated.version),
    );
    expect(courseSchema.parse(replaced.json()).prerequisiteIds).toEqual([a2?.id]);
    expect((await course(b1.id)).prerequisiteIds).toEqual([a2?.id]);

    // A stale version is refused and changes nothing.
    const stale = await asAdmin(
      'PUT',
      `/courses/${b1.id}/prerequisites`,
      { courseIds: [] },
      ifMatch(b1.version),
    );
    expect(stale.statusCode).toBe(412);
    expect((await course(b1.id)).prerequisiteIds).toEqual([a2?.id]);
  });

  it('rejects self, other-program and unknown prerequisites', async () => {
    const list = courseListResponseSchema.parse(
      (await asAdmin('GET', `/courses?programId=${programId}`)).json(),
    );
    const a1 = list.items.find((c) => c.code === 'A1');
    const french = courseListResponseSchema.parse(
      (await asAdmin('GET', `/courses?programId=${otherProgramId}`)).json(),
    ).items[0];

    for (const courseIds of [[a1?.id], [french?.id], ['0199a1b2-0000-7000-8000-000000000000']]) {
      const res = await asAdmin(
        'PUT',
        `/courses/${a1?.id}/prerequisites`,
        { courseIds },
        ifMatch(a1?.version ?? 1),
      );
      expect(res.statusCode).toBe(422);
      expect(code(res)).toBe('CROSS_PROGRAM_PREREQUISITE');
    }
  });

  it('rejects direct and indirect loops', async () => {
    // Chain so far: B1 needs A2. Making A2 need B1 closes a loop; so does A2 → A1 → B1.
    const list = courseListResponseSchema.parse(
      (await asAdmin('GET', `/courses?programId=${programId}`)).json(),
    );
    const [a1, a2, b1] = ['A1', 'A2', 'B1'].map((c) => list.items.find((x) => x.code === c));

    const direct = await asAdmin(
      'PUT',
      `/courses/${a2?.id}/prerequisites`,
      { courseIds: [b1?.id] },
      ifMatch(a2?.version ?? 1),
    );
    expect(direct.statusCode).toBe(422);
    expect(code(direct)).toBe('PREREQUISITE_CYCLE');

    // A1 → B1 → A2 is fine on its own; then A2 → A1 would loop through it.
    const ok = await asAdmin(
      'PUT',
      `/courses/${a1?.id}/prerequisites`,
      { courseIds: [b1?.id] },
      ifMatch(a1?.version ?? 1),
    );
    expect(ok.statusCode).toBe(200);
    const indirect = await asAdmin(
      'PUT',
      `/courses/${a2?.id}/prerequisites`,
      { courseIds: [a1?.id] },
      ifMatch(a2?.version ?? 1),
    );
    expect(indirect.statusCode).toBe(422);
    expect(code(indirect)).toBe('PREREQUISITE_CYCLE');
  });

  it('never lets two concurrent edits create a loop', async () => {
    const [x, y] = [await make(otherProgramId, 'X1', 5), await make(otherProgramId, 'Y1', 6)];
    // X needs Y and Y needs X, sent at the same moment: exactly one may win.
    const [first, second] = await Promise.all([
      asAdmin('PUT', `/courses/${x.id}/prerequisites`, { courseIds: [y.id] }, ifMatch(x.version)),
      asAdmin('PUT', `/courses/${y.id}/prerequisites`, { courseIds: [x.id] }, ifMatch(y.version)),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 422]);
    const [xNow, yNow] = await Promise.all([course(x.id), course(y.id)]);
    expect(xNow.prerequisiteIds.length + yNow.prerequisiteIds.length).toBe(1);
  });

  it('checks the department scope for courses and prerequisites', async () => {
    const languageCourse = await make(programId, 'Z1', 9);
    const webProgram = programListResponseSchema
      .parse((await asAdmin('GET', `/programs?departmentId=${computer.id}`)).json())
      .items.find((p) => p.code === 'WEB');

    // A Language Coordinator can add courses to Language programs, not Computer ones.
    const own = await asLanguageCoordinator('POST', '/courses', {
      programId,
      code: 'Z2',
      name: 'Coordinator course',
    });
    expect(own.statusCode).toBe(201);
    const other = await asLanguageCoordinator('POST', '/courses', {
      programId: webProgram?.id,
      code: 'HTML',
      name: 'HTML',
    });
    expect(other.statusCode).toBe(403);

    const webCourse = await create(
      asAdmin,
      '/courses',
      { programId: webProgram?.id, code: 'JS', name: 'JavaScript' },
      courseSchema,
    );
    const denied = await asLanguageCoordinator(
      'PUT',
      `/courses/${webCourse.id}/prerequisites`,
      { courseIds: [] },
      ifMatch(webCourse.version),
    );
    expect(denied.statusCode).toBe(403);
    const allowed = await asLanguageCoordinator(
      'PUT',
      `/courses/${languageCourse.id}/prerequisites`,
      { courseIds: [] },
      ifMatch(languageCourse.version),
    );
    expect(allowed.statusCode).toBe(200);
  });

  it('audits catalog changes', async () => {
    const audit = auditListResponseSchema.parse(
      (await asAdmin('GET', '/audit-log?action=course.prerequisites_set')).json(),
    );
    expect(audit.items.length).toBeGreaterThan(0);
    expect(audit.items[0]?.changes).toHaveProperty('prerequisiteIds');
    const created = auditListResponseSchema.parse(
      (await asAdmin('GET', '/audit-log?action=program.created')).json(),
    );
    expect(created.items.some((e) => e.changes.code === 'GENL')).toBe(true);
  });
});

describe('academic years', () => {
  const year = (name: string, startDate: string, endDate: string) =>
    asAdmin('POST', '/academic-years', { name, startDate, endDate });

  it('keeps years from overlapping, at the database level', async () => {
    expect((await year('2026', '2026-07-08', '2027-07-08')).statusCode).toBe(201);

    const overlap = await year('2026 late', '2027-01-01', '2027-12-31');
    expect(overlap.statusCode).toBe(409);
    expect(code(overlap)).toBe('ACADEMIC_YEAR_OVERLAP');

    // Back to back is fine: the end date belongs to the next year.
    const next = await year('2027', '2027-07-08', '2028-07-08');
    expect(next.statusCode).toBe(201);
  });

  it('rejects overlap when editing, and a reused name', async () => {
    const next = academicYearSchema.parse((await year('2028', '2028-07-08', '2029-07-08')).json());
    const overlapping = await asAdmin(
      'PATCH',
      `/academic-years/${next.id}`,
      { name: '2028', startDate: '2028-01-01', endDate: '2029-07-08' },
      ifMatch(next.version),
    );
    expect(overlapping.statusCode).toBe(409);
    expect(code(overlapping)).toBe('ACADEMIC_YEAR_OVERLAP');

    const renamed = await asAdmin(
      'PATCH',
      `/academic-years/${next.id}`,
      { name: '2026', startDate: '2028-07-08', endDate: '2029-07-08' },
      ifMatch(next.version),
    );
    expect(renamed.statusCode).toBe(409);
    expect(code(renamed)).toBe('CODE_TAKEN');
  });

  it('rejects two overlapping years created at the same moment', async () => {
    const results = await Promise.all([
      year('2030 a', '2030-07-08', '2031-07-08'),
      year('2030 b', '2030-09-01', '2031-09-01'),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  });

  it('lets staff read years but only admins change them', async () => {
    expect((await asSecretary('GET', '/academic-years')).statusCode).toBe(200);
    expect(
      (
        await asLanguageCoordinator('POST', '/academic-years', {
          name: 'Nope',
          startDate: '2040-01-01',
          endDate: '2040-12-31',
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('intakes', () => {
  it('applies to one program or to any', async () => {
    const program = programListResponseSchema
      .parse((await asAdmin('GET', '/programs')).json())
      .items.find((p) => p.code === 'GENL');
    const specific = await create(
      asAdmin,
      '/intakes',
      {
        programId: program?.id,
        name: 'September',
        startDate: '2026-09-14',
        registrationOpensAt: '2026-08-01T00:00:00Z',
        registrationClosesAt: '2026-09-10T00:00:00Z',
      },
      intakeSchema,
    );
    expect(specific.registrationOpensAt).toBe('2026-08-01T00:00:00.000Z');

    const any = await create(
      asAdmin,
      '/intakes',
      { name: 'Open', startDate: '2026-10-01' },
      intakeSchema,
    );
    expect(any.programId).toBeNull();

    const missing = await asAdmin('POST', '/intakes', {
      programId: '0199a1b2-0000-7000-8000-000000000000',
      name: 'Ghost',
      startDate: '2026-10-01',
    });
    expect(missing.statusCode).toBe(422);
  });

  it('checks the registration window against the stored other side', async () => {
    const intake = await create(
      asAdmin,
      '/intakes',
      {
        name: 'Window',
        startDate: '2027-01-10',
        registrationOpensAt: '2026-12-01T00:00:00Z',
        registrationClosesAt: '2027-01-05T00:00:00Z',
      },
      intakeSchema,
    );
    // Only moving "opens" past the stored "closes" isn't caught by the schema; the service does.
    const bad = await asAdmin(
      'PATCH',
      `/intakes/${intake.id}`,
      { registrationOpensAt: '2027-02-01T00:00:00Z' },
      ifMatch(intake.version),
    );
    expect(bad.statusCode).toBe(422);
    expect(code(bad)).toBe('INVALID_REGISTRATION_WINDOW');

    const ok = await asAdmin(
      'PATCH',
      `/intakes/${intake.id}`,
      { registrationClosesAt: null, isActive: false },
      ifMatch(intake.version),
    );
    expect(intakeSchema.parse(ok.json())).toMatchObject({
      registrationClosesAt: null,
      isActive: false,
    });
  });
});

describe('holidays', () => {
  it('allows one holiday per date and branch, counting "every branch" as one', async () => {
    const base = { date: '2026-09-27', name: 'Meskel' };
    const everywhere = await create(asAdmin, '/holidays', base, holidaySchema);
    expect(everywhere.branchId).toBeNull();

    const dup = await asAdmin('POST', '/holidays', base);
    expect(dup.statusCode).toBe(409);
    expect(code(dup)).toBe('HOLIDAY_EXISTS');

    // The same date for one branch is a different holiday.
    const branchOnly = await asAdmin('POST', '/holidays', {
      ...base,
      name: 'Bole fair',
      branchId: bole.id,
    });
    expect(branchOnly.statusCode).toBe(201);
    const dupBranch = await asAdmin('POST', '/holidays', { ...base, branchId: bole.id });
    expect(code(dupBranch)).toBe('HOLIDAY_EXISTS');
  });

  it('needs an active branch, updates, and deletes', async () => {
    const bad = await asAdmin('POST', '/holidays', {
      date: '2026-10-05',
      name: 'Ghost branch',
      branchId: '0199a1b2-0000-7000-8000-000000000000',
    });
    expect(bad.statusCode).toBe(422);
    expect(code(bad)).toBe('BRANCH_NOT_FOUND');

    const holiday = await create(
      asAdmin,
      '/holidays',
      { date: '2027-01-07', name: 'Christmas', isRecurringAnnually: true },
      holidaySchema,
    );
    const renamed = await asAdmin(
      'PATCH',
      `/holidays/${holiday.id}`,
      { name: 'Genna' },
      ifMatch(holiday.version),
    );
    expect(holidaySchema.parse(renamed.json()).name).toBe('Genna');

    expect((await asAdmin('DELETE', `/holidays/${holiday.id}`)).statusCode).toBe(204);
    expect((await asAdmin('DELETE', `/holidays/${holiday.id}`)).statusCode).toBe(404);
    const gone = auditListResponseSchema.parse(
      (await asAdmin('GET', '/audit-log?action=holiday.deleted')).json(),
    );
    expect(gone.items[0]?.changes).toMatchObject({ date: '2027-01-07', name: 'Genna' });
  });
});

describe('shifts', () => {
  it('stores the days and times and returns them as HH:MM', async () => {
    const shift = await create(
      asAdmin,
      '/shifts',
      { code: 'eve', name: 'Evening', daysOfWeek: [5, 1, 3], startTime: '17:00', endTime: '19:00' },
      shiftSchema,
    );
    expect(shift).toMatchObject({
      code: 'EVE',
      daysOfWeek: [1, 3, 5],
      startTime: '17:00',
      endTime: '19:00',
    });

    const dup = await asAdmin('POST', '/shifts', {
      code: 'EVE',
      name: 'Again',
      daysOfWeek: [2],
      startTime: '08:00',
      endTime: '10:00',
    });
    expect(code(dup)).toBe('CODE_TAKEN');
  });

  it('checks a one-sided time change against the stored time', async () => {
    const shift = await create(
      asAdmin,
      '/shifts',
      {
        code: 'MOR',
        name: 'Morning',
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: '08:00',
        endTime: '10:00',
      },
      shiftSchema,
    );
    const bad = await asAdmin(
      'PATCH',
      `/shifts/${shift.id}`,
      { startTime: '11:00' },
      ifMatch(shift.version),
    );
    expect(bad.statusCode).toBe(422);
    expect(code(bad)).toBe('INVALID_TIME_RANGE');

    const ok = await asAdmin(
      'PATCH',
      `/shifts/${shift.id}`,
      { endTime: '12:30', isActive: false },
      ifMatch(shift.version),
    );
    expect(shiftSchema.parse(ok.json())).toMatchObject({ endTime: '12:30', isActive: false });
  });

  it('is readable by instructors but not editable', async () => {
    expect((await asSecretary('GET', '/shifts')).statusCode).toBe(200);
    expect(
      (
        await asSecretary('POST', '/shifts', {
          code: 'NOPE',
          name: 'Nope',
          daysOfWeek: [1],
          startTime: '08:00',
          endTime: '09:00',
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('rooms', () => {
  it('belongs to an active branch and keeps codes unique per branch', async () => {
    const room = await create(
      asAdmin,
      '/rooms',
      {
        branchId: bole.id,
        code: 'LAB1',
        name: 'Computer Lab 1',
        type: 'lab',
        capacity: 24,
        features: ['projector', 'air conditioning'],
      },
      roomSchema,
    );
    expect(room).toMatchObject({ capacity: 24, features: ['projector', 'air conditioning'] });

    const dup = await asAdmin('POST', '/rooms', {
      branchId: bole.id,
      code: 'LAB1',
      name: 'Again',
      type: 'lab',
      capacity: 10,
    });
    expect(code(dup)).toBe('CODE_TAKEN');
    // The same code at another branch is a different room.
    const other = await asAdmin('POST', '/rooms', {
      branchId: piassa.id,
      code: 'LAB1',
      name: 'Piassa lab',
      type: 'lab',
      capacity: 12,
    });
    expect(other.statusCode).toBe(201);

    const noBranch = await asAdmin('POST', '/rooms', {
      branchId: '0199a1b2-0000-7000-8000-000000000000',
      code: 'X1',
      name: 'Ghost',
      type: 'classroom',
      capacity: 10,
    });
    expect(code(noBranch)).toBe('BRANCH_NOT_FOUND');
  });

  it('filters by branch and updates capacity', async () => {
    const list = await asAdmin('GET', `/rooms?branchId=${piassa.id}`);
    const rooms = roomListResponseSchema.parse(list.json()).items;
    expect(rooms.every((r) => r.branchId === piassa.id)).toBe(true);
    const [room] = rooms;
    const res = await asAdmin(
      'PATCH',
      `/rooms/${room?.id}`,
      { capacity: 20, isActive: false },
      ifMatch(room?.version ?? 1),
    );
    expect(roomSchema.parse(res.json())).toMatchObject({ capacity: 20, isActive: false });
  });
});
