import { randomUUID } from 'node:crypto';

import {
  applicationSchema,
  auditListResponseSchema,
  branchSchema,
  classSessionListResponseSchema,
  cohortListResponseSchema,
  cohortSchema,
  convertResponseSchema,
  courseSchema,
  departmentSchema,
  enrollmentListResponseSchema,
  enrollmentSchema,
  enrollResponseSchema,
  holidaySchema,
  instructorListResponseSchema,
  problemDetailsSchema,
  programSchema,
  roomSchema,
  shiftSchema,
  studentSchema,
  withdrawResponseSchema,
} from '@emis/contracts';
import { roles, userRoleAssignments } from '@emis/db';
import { createIsolatedDatabase, type TestDatabaseUrls } from '@emis/db/testing';
import type { Scope } from '@emis/permissions';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { ClsService } from 'nestjs-cls';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { DbAdapter } from '../../database/database.module.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { callAs, createStaff, type StaffFixture } from '../../testing/staff-fixtures.js';

// Own database: room and instructor bookings are global, and seat counts must start from zero.
let urls: TestDatabaseUrls;
let app: NestFastifyApplication;
let asAdmin: ReturnType<typeof callAs>;
let asBoleDesk: ReturnType<typeof callAs>;
let asLanguageCoordinator: ReturnType<typeof callAs>;

let bole: { id: string };
let piassa: { id: string };
let a1: { id: string; version: number };
let a2: { id: string; version: number };
let py1: { id: string };
let eve: { id: string };
let late: { id: string };
let night: { id: string };
let morning: { id: string };
let smallRoom: { id: string }; // Bole, 10 seats
let bigRoom: { id: string }; // Bole, 30 seats
let piassaRoom: { id: string };
let teacherA: StaffFixture;
let teacherB: StaffFixture;

const code = (res: LightMyRequestResponse) => problemDetailsSchema.parse(res.json()).code;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const key = () => ({ 'idempotency-key': randomUUID() });

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

async function post<T>(
  who: ReturnType<typeof callAs>,
  url: string,
  payload: object,
  schema: { parse: (v: unknown) => T },
): Promise<T> {
  const res = await who('POST', url, payload, key());
  expect(res.statusCode, res.body).toBe(201);
  return schema.parse(res.json());
}

/** Monday of the nth week from a fixed start: gives each test its own dates so bookings never collide by accident. */
let weekCounter = 0;
function nextWeek() {
  const start = new Date(Date.UTC(2027, 0, 4 + 7 * weekCounter++));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 4);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

const cohortBody = (overrides: Record<string, unknown> = {}) => ({
  name: `Class ${randomUUID().slice(0, 6)}`,
  courseId: a1.id,
  shiftId: eve.id,
  roomId: smallRoom.id,
  maxSize: 10,
  ...nextWeek(),
  ...overrides,
});

const makeCohort = async (overrides: Record<string, unknown> = {}, who = asAdmin) =>
  post(who, '/cohorts', cohortBody(overrides), cohortSchema);

const setStatus = async (
  cohort: { id: string; version: number },
  status: string,
  who = asAdmin,
) => {
  const res = await who(
    'POST',
    `/cohorts/${cohort.id}/status`,
    { status },
    ifMatch(cohort.version),
  );
  expect(res.statusCode, res.body).toBe(200);
  return cohortSchema.parse(res.json());
};

const openCohort = async (overrides: Record<string, unknown> = {}) =>
  setStatus(await makeCohort(overrides), 'open');

let studentCounter = 0;
const nextStudent = async () => {
  const n = ++studentCounter;
  const res = await asBoleDesk(
    'POST',
    '/students',
    {
      givenName: `Student${n}`,
      fatherName: `Family${String(n).padStart(3, '0')}`,
      gender: 'female',
      phone: `09${String(20_000_000 + n)}`,
      branchId: bole.id,
      confirmNotDuplicate: true,
    },
    key(),
  );
  expect(res.statusCode, res.body).toBe(201);
  return studentSchema.parse(res.json());
};

const enroll = (studentId: string, cohortId: string, who = asBoleDesk, headers = key()) =>
  who('POST', '/enrollments', { studentId, cohortId }, headers);

const enrollOk = async (studentId: string, cohortId: string) => {
  const res = await enroll(studentId, cohortId);
  expect(res.statusCode, res.body).toBe(201);
  return enrollResponseSchema.parse(res.json());
};

const cohortNow = async (id: string) =>
  cohortSchema.parse((await asAdmin('GET', `/cohorts/${id}`)).json());

const roster = async (cohortId: string, status?: string) =>
  enrollmentListResponseSchema.parse(
    (
      await asAdmin(
        'GET',
        `/enrollments?cohortId=${cohortId}&limit=200${status ? `&status=${status}` : ''}`,
      )
    ).json(),
  ).items;

beforeAll(async () => {
  urls = await createIsolatedDatabase(inject('database'), 'emis_cohorts_test');
  app = await createTestApp({ env: { DATABASE_URL: urls.appUrl, RATE_LIMIT_MAX: '100000' } });
  asAdmin = callAs(
    app,
    await createStaff(app, { email: 'cohorts-admin@lingua.test', roleKey: 'admin' }),
  );

  const language = await post(
    asAdmin,
    '/departments',
    { code: 'LANG', name: 'Language' },
    departmentSchema,
  );
  const computer = await post(
    asAdmin,
    '/departments',
    { code: 'COMP', name: 'Computer' },
    departmentSchema,
  );
  bole = await post(asAdmin, '/branches', { code: 'BOLE', name: 'Bole' }, branchSchema);
  piassa = await post(asAdmin, '/branches', { code: 'PIAZ', name: 'Piassa' }, branchSchema);

  const english = await post(
    asAdmin,
    '/programs',
    { departmentId: language.id, code: 'ENG', name: 'English', type: 'long_course' },
    programSchema,
  );
  const python = await post(
    asAdmin,
    '/programs',
    { departmentId: computer.id, code: 'PYTH', name: 'Python', type: 'short_course' },
    programSchema,
  );
  a1 = await post(
    asAdmin,
    '/courses',
    { programId: english.id, code: 'A1', name: 'English A1', levelOrder: 1 },
    courseSchema,
  );
  a2 = await post(
    asAdmin,
    '/courses',
    {
      programId: english.id,
      code: 'A2',
      name: 'English A2',
      levelOrder: 2,
      minAttendancePercent: 80,
      minScore: 60,
    },
    courseSchema,
  );
  py1 = await post(
    asAdmin,
    '/courses',
    { programId: python.id, code: 'PY1', name: 'Python 1' },
    courseSchema,
  );
  const withPrereq = await asAdmin(
    'PUT',
    `/courses/${a2.id}/prerequisites`,
    { courseIds: [a1.id] },
    ifMatch(a2.version),
  );
  a2 = courseSchema.parse(withPrereq.json());

  const shift = (shiftCode: string, days: number[], startTime: string, endTime: string) =>
    post(
      asAdmin,
      '/shifts',
      { code: shiftCode, name: shiftCode, daysOfWeek: days, startTime, endTime },
      shiftSchema,
    );
  eve = await shift('EVE', [1, 3, 5], '17:00', '19:00');
  late = await shift('LATE', [1, 3, 5], '18:00', '20:00');
  night = await shift('NIGHT', [1, 3, 5], '19:00', '21:00');
  morning = await shift('MOR', [1, 2, 3, 4, 5], '08:00', '10:00');

  const room = (branchId: string, roomCode: string, capacity: number) =>
    post(
      asAdmin,
      '/rooms',
      { branchId, code: roomCode, name: roomCode, type: 'classroom', capacity },
      roomSchema,
    );
  smallRoom = await room(bole.id, 'R1', 10);
  bigRoom = await room(bole.id, 'R2', 30);
  piassaRoom = await room(piassa.id, 'R3', 20);

  teacherA = await createStaff(app, {
    email: 'teacher-a@lingua.test',
    roleKey: 'instructor',
    displayName: 'Teacher A',
  });
  teacherB = await createStaff(app, {
    email: 'teacher-b@lingua.test',
    roleKey: 'instructor',
    displayName: 'Teacher B',
  });

  await post(
    asAdmin,
    '/descriptors',
    { namespace: 'withdrawal_reason', code: 'financial', label: 'Financial' },
    { parse: (v: unknown) => v },
  );

  const desk = await createStaff(app, { email: 'cohorts-desk@lingua.test' });
  await grantRole(desk, 'secretary', { type: 'branch', id: bole.id });
  asBoleDesk = callAs(app, desk);
  const coordinator = await createStaff(app, { email: 'cohorts-coord@lingua.test' });
  await grantRole(coordinator, 'coordinator', { type: 'department', id: language.id });
  asLanguageCoordinator = callAs(app, coordinator);
});
afterAll(() => app.close());

describe('creating cohorts and their timetable', () => {
  it('generates a session for every shift day, at the institution’s clock time', async () => {
    const cohort = await makeCohort({ startDate: '2026-09-14', endDate: '2026-09-25' });
    expect(cohort).toMatchObject({
      status: 'planned',
      sessionCount: 6,
      seatsLeft: 10,
      branchId: bole.id,
    });

    const { items } = classSessionListResponseSchema.parse(
      (await asAdmin('GET', `/cohorts/${cohort.id}/sessions`)).json(),
    );
    expect(items.map((s) => s.sessionDate)).toEqual([
      '2026-09-14',
      '2026-09-16',
      '2026-09-18',
      '2026-09-21',
      '2026-09-23',
      '2026-09-25',
    ]);
    // 17:00 in Addis Ababa (UTC+3) is 14:00 UTC.
    expect(items[0]).toMatchObject({
      startsAt: '2026-09-14T14:00:00.000Z',
      endsAt: '2026-09-14T16:00:00.000Z',
    });
  });

  it('skips holidays', async () => {
    await post(asAdmin, '/holidays', { date: '2026-11-04', name: 'Test holiday' }, holidaySchema);
    // Wed 4 Nov is a shift day: 2–6 Nov has Mon–Fri = Mon 2, Wed 4, Fri 6, minus the holiday.
    const cohort = await makeCohort({ startDate: '2026-11-02', endDate: '2026-11-06' });
    expect(cohort.sessionCount).toBe(2);
  });

  it('caps seats at the smaller of the room and the limit', async () => {
    expect((await makeCohort({ roomId: smallRoom.id, maxSize: 25 })).capacity).toBe(10);
    expect((await makeCohort({ roomId: bigRoom.id, maxSize: 5 })).capacity).toBe(5);
  });

  it('refuses a schedule with no classes, an unknown room, and a non-instructor', async () => {
    const none = await asAdmin(
      'POST',
      '/cohorts',
      cohortBody({ startDate: '2027-03-02', endDate: '2027-03-02' }),
      key(),
    );
    expect(none.statusCode).toBe(422);
    expect(code(none)).toBe('NO_SESSIONS');

    const room = await asAdmin(
      'POST',
      '/cohorts',
      cohortBody({ roomId: '0199a1b2-0000-7000-8000-000000000000' }),
      key(),
    );
    expect(code(room)).toBe('REFERENCE_NOT_FOUND');

    const notTeacher = await asAdmin(
      'POST',
      '/cohorts',
      cohortBody({
        instructorId: (
          await createStaff(app, { email: 'desk-2@lingua.test', roleKey: 'secretary' })
        ).userId,
      }),
      key(),
    );
    expect(notTeacher.statusCode).toBe(422);
    expect(code(notTeacher)).toBe('NOT_AN_INSTRUCTOR');
    const tooLong = await asAdmin(
      'POST',
      '/cohorts',
      cohortBody({ startDate: '2027-01-01', endDate: '2031-12-31' }),
      key(),
    );
    expect(code(tooLong)).toBe('TOO_MANY_SESSIONS');
  });

  it('lists instructors for the assignment picker', async () => {
    const res = await asAdmin('GET', '/cohorts/instructors');
    const names = instructorListResponseSchema.parse(res.json()).items.map((i) => i.displayName);
    expect(names).toEqual(expect.arrayContaining(['Teacher A', 'Teacher B']));
  });
});

describe('double-booking', () => {
  it('refuses a second cohort in the same room at an overlapping time, and leaves nothing behind', async () => {
    const week = nextWeek();
    const first = await makeCohort({ ...week, roomId: bigRoom.id, shiftId: eve.id });
    const before = cohortListResponseSchema.parse(
      (await asAdmin('GET', '/cohorts?limit=100')).json(),
    ).items.length;

    // LATE (18–20) overlaps EVE (17–19) in the same room on the same days.
    const clash = await asAdmin(
      'POST',
      '/cohorts',
      cohortBody({ ...week, roomId: bigRoom.id, shiftId: late.id }),
      key(),
    );
    expect(clash.statusCode).toBe(409);
    expect(code(clash)).toBe('ROOM_CONFLICT');
    const after = cohortListResponseSchema.parse(
      (await asAdmin('GET', '/cohorts?limit=100')).json(),
    ).items.length;
    expect(after).toBe(before);

    // Back-to-back (19–21 right after 17–19), another room, and another week are all fine.
    expect(
      (
        await asAdmin(
          'POST',
          '/cohorts',
          cohortBody({ ...week, roomId: bigRoom.id, shiftId: night.id }),
          key(),
        )
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await asAdmin(
          'POST',
          '/cohorts',
          cohortBody({ ...week, roomId: smallRoom.id, shiftId: late.id }),
          key(),
        )
      ).statusCode,
    ).toBe(201);
    expect(first.sessionCount).toBe(3);
  });

  it('refuses one instructor in two places at once', async () => {
    const week = nextWeek();
    await makeCohort({
      ...week,
      roomId: smallRoom.id,
      shiftId: eve.id,
      instructorId: teacherA.userId,
    });

    const clash = await asAdmin(
      'POST',
      '/cohorts',
      cohortBody({ ...week, roomId: bigRoom.id, shiftId: late.id, instructorId: teacherA.userId }),
      key(),
    );
    expect(clash.statusCode).toBe(409);
    expect(code(clash)).toBe('INSTRUCTOR_CONFLICT');
    const other = await asAdmin(
      'POST',
      '/cohorts',
      cohortBody({ ...week, roomId: bigRoom.id, shiftId: late.id, instructorId: teacherB.userId }),
      key(),
    );
    expect(other.statusCode).toBe(201);
  });

  it('is enforced by the database itself, not just the API', async () => {
    const week = nextWeek();
    const cohort = await makeCohort({
      ...week,
      roomId: bigRoom.id,
      shiftId: eve.id,
      instructorId: teacherA.userId,
    });
    const other = await makeCohort({ ...week, roomId: smallRoom.id, shiftId: morning.id });
    const client = new pg.Client({ connectionString: urls.appUrl });
    await client.connect();
    try {
      const insert = (roomId: string, instructorId: string | null, cohortId: string) =>
        client.query(
          `INSERT INTO class_sessions (cohort_id, room_id, instructor_id, session_date, starts_at, ends_at)
           SELECT $1::uuid, $2::uuid, $3::uuid, session_date, starts_at + interval '30 minutes', ends_at + interval '30 minutes'
           FROM class_sessions WHERE cohort_id = $4 LIMIT 1`,
          [cohortId, roomId, instructorId, cohort.id],
        );
      await expect(insert(bigRoom.id, null, other.id)).rejects.toThrow(
        /class_sessions_room_no_overlap/,
      );
      await expect(insert(smallRoom.id, teacherA.userId, other.id)).rejects.toThrow(
        /class_sessions_instructor_no_overlap/,
      );
    } finally {
      await client.end();
    }
  });

  it('does not let two simultaneous requests both book the same room', async () => {
    const week = nextWeek();
    const results = await Promise.all(
      [1, 2, 3, 4].map(() =>
        asAdmin(
          'POST',
          '/cohorts',
          cohortBody({ ...week, roomId: bigRoom.id, shiftId: morning.id }),
          key(),
        ),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409]);
  });

  it('frees the room when a cohort is cancelled', async () => {
    const week = nextWeek();
    const cohort = await makeCohort({ ...week, roomId: bigRoom.id, shiftId: eve.id });
    expect(
      (
        await asAdmin(
          'POST',
          '/cohorts',
          cohortBody({ ...week, roomId: bigRoom.id, shiftId: eve.id }),
          key(),
        )
      ).statusCode,
    ).toBe(409);
    await setStatus(cohort, 'cancelled');
    expect(
      (
        await asAdmin(
          'POST',
          '/cohorts',
          cohortBody({ ...week, roomId: bigRoom.id, shiftId: eve.id }),
          key(),
        )
      ).statusCode,
    ).toBe(201);
  });
});

describe('who may schedule', () => {
  it('lets a department Coordinator schedule their own department only', async () => {
    const own = await asLanguageCoordinator(
      'POST',
      '/cohorts',
      cohortBody({ courseId: a1.id }),
      key(),
    );
    expect(own.statusCode, own.body).toBe(201);
    const other = await asLanguageCoordinator(
      'POST',
      '/cohorts',
      cohortBody({ courseId: py1.id }),
      key(),
    );
    expect(other.statusCode).toBe(403);
    expect((await asBoleDesk('POST', '/cohorts', cohortBody(), key())).statusCode).toBe(403);

    const cohort = cohortSchema.parse(own.json());
    expect((await asBoleDesk('GET', `/cohorts/${cohort.id}`)).statusCode).toBe(200);
    const denied = await asLanguageCoordinator(
      'POST',
      `/cohorts/${(await makeCohort({ courseId: py1.id })).id}/status`,
      { status: 'open' },
      ifMatch(1),
    );
    expect(denied.statusCode).toBe(403);
  });

  it('keeps a branch Secretary to their branch’s cohorts', async () => {
    const elsewhere = await openCohort({ roomId: piassaRoom.id, maxSize: 10 });
    expect((await asBoleDesk('GET', `/cohorts/${elsewhere.id}`)).statusCode).toBe(403);
    const seen = cohortListResponseSchema.parse(
      (await asBoleDesk('GET', '/cohorts?limit=100')).json(),
    );
    expect(seen.items.every((c) => c.branchId === bole.id)).toBe(true);
    const student = await nextStudent();
    expect((await enroll(student.id, elsewhere.id)).statusCode).toBe(403);
  });
});

describe('cohort lifecycle', () => {
  it('follows planned → open → running → completed, and only takes enrollments while open or running', async () => {
    const cohort = await makeCohort();
    const student = await nextStudent();
    const early = await enroll(student.id, cohort.id);
    expect(early.statusCode).toBe(409);
    expect(code(early)).toBe('COHORT_NOT_ENROLLING');

    const skip = await asAdmin(
      'POST',
      `/cohorts/${cohort.id}/status`,
      { status: 'running' },
      ifMatch(cohort.version),
    );
    expect(code(skip)).toBe('INVALID_COHORT_TRANSITION');

    const open = await setStatus(cohort, 'open');
    await enrollOk(student.id, cohort.id);
    const running = await setStatus(open, 'running');
    const late = await enrollOk((await nextStudent()).id, cohort.id);
    expect(late.outcome).toBe('enrolled');

    const blocked = await asAdmin(
      'POST',
      `/cohorts/${cohort.id}/status`,
      { status: 'completed' },
      ifMatch(running.version),
    );
    expect(blocked.statusCode).toBe(409);
    expect(code(blocked)).toBe('COHORT_HAS_ENROLLMENTS');
  });

  it('will not cancel a cohort that still has students, but cancels an empty one', async () => {
    const cohort = await openCohort();
    const student = await nextStudent();
    await enrollOk(student.id, cohort.id);
    const refused = await asAdmin(
      'POST',
      `/cohorts/${cohort.id}/status`,
      { status: 'cancelled' },
      ifMatch(cohort.version),
    );
    expect(code(refused)).toBe('COHORT_HAS_ENROLLMENTS');

    const empty = await openCohort();
    const cancelled = await setStatus(empty, 'cancelled');
    expect(cancelled.sessionCount).toBe(0);
    const again = await asAdmin(
      'POST',
      `/cohorts/${empty.id}/status`,
      { status: 'open' },
      ifMatch(cancelled.version),
    );
    expect(code(again)).toBe('INVALID_COHORT_TRANSITION');
  });

  it('changes the schedule before classes start, and not after', async () => {
    const cohort = await openCohort({ startDate: '2027-06-07', endDate: '2027-06-11' });
    expect(cohort.sessionCount).toBe(3);
    const longer = await asAdmin(
      'PATCH',
      `/cohorts/${cohort.id}`,
      { endDate: '2027-06-18' },
      ifMatch(cohort.version),
    );
    expect(cohortSchema.parse(longer.json())).toMatchObject({
      sessionCount: 6,
      endDate: '2027-06-18',
    });

    // A clash on the new room leaves the cohort as it was.
    const blocker = await makeCohort({
      startDate: '2027-06-07',
      endDate: '2027-06-11',
      roomId: bigRoom.id,
      shiftId: eve.id,
    });
    const moved = cohortSchema.parse(longer.json());
    const clash = await asAdmin(
      'PATCH',
      `/cohorts/${cohort.id}`,
      { roomId: bigRoom.id },
      ifMatch(moved.version),
    );
    expect(code(clash)).toBe('ROOM_CONFLICT');
    expect((await cohortNow(cohort.id)).roomId).toBe(smallRoom.id);
    expect(blocker.roomId).toBe(bigRoom.id);

    const running = await setStatus(moved, 'running');
    const locked = await asAdmin(
      'PATCH',
      `/cohorts/${cohort.id}`,
      { endDate: '2027-07-30' },
      ifMatch(running.version),
    );
    expect(locked.statusCode).toBe(409);
    expect(code(locked)).toBe('SCHEDULE_LOCKED');
    // Renaming is still fine.
    expect(
      (
        await asAdmin(
          'PATCH',
          `/cohorts/${cohort.id}`,
          { name: 'Renamed' },
          ifMatch(running.version),
        )
      ).statusCode,
    ).toBe(200);
  });

  it('never drops seats below the students already enrolled', async () => {
    const cohort = await openCohort({ maxSize: 10 });
    for (let i = 0; i < 3; i += 1) await enrollOk((await nextStudent()).id, cohort.id);
    const res = await asAdmin(
      'PATCH',
      `/cohorts/${cohort.id}`,
      { maxSize: 2 },
      ifMatch(cohort.version),
    );
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe('CAPACITY_BELOW_ENROLLED');
    expect(
      (await asAdmin('PATCH', `/cohorts/${cohort.id}`, { maxSize: 3 }, ifMatch(cohort.version)))
        .statusCode,
    ).toBe(200);
  });
});

describe('enrolling', () => {
  it('takes a seat, refuses a second enrollment, and refuses inactive students', async () => {
    const cohort = await openCohort();
    const student = await nextStudent();
    const first = await enrollOk(student.id, cohort.id);
    expect(first).toMatchObject({
      outcome: 'enrolled',
      enrollment: {
        status: 'active',
        waitlistPosition: null,
        studentNumber: student.studentNumber,
      },
    });
    expect((await cohortNow(cohort.id)).seatsLeft).toBe(9);

    const again = await enroll(student.id, cohort.id);
    expect(again.statusCode).toBe(409);
    expect(code(again)).toBe('ALREADY_ENROLLED');

    const held = await nextStudent();
    await asBoleDesk('PATCH', `/students/${held.id}`, { status: 'on_hold' }, ifMatch(held.version));
    const res = await enroll(held.id, cohort.id);
    expect(res.statusCode).toBe(422);
    expect(code(res)).toBe('STUDENT_NOT_ACTIVE');
  });

  it('replays a retried request instead of enrolling twice', async () => {
    const cohort = await openCohort();
    const student = await nextStudent();
    const headers = key();
    const first = await enroll(student.id, cohort.id, asBoleDesk, headers);
    const second = await enroll(student.id, cohort.id, asBoleDesk, headers);
    expect(second.json()).toEqual(first.json());
    expect(await roster(cohort.id)).toHaveLength(1);
    // Without an Idempotency-Key the request is refused outright.
    const keyless = await asBoleDesk('POST', '/enrollments', {
      studentId: student.id,
      cohortId: cohort.id,
    });
    expect(keyless.statusCode).toBe(400);
  });

  it('puts students on a numbered waitlist once the class is full', async () => {
    const cohort = await openCohort({ maxSize: 2 });
    const students = await Promise.all([
      nextStudent(),
      nextStudent(),
      nextStudent(),
      nextStudent(),
    ]);
    const outcomes = [];
    for (const s of students) outcomes.push(await enrollOk(s.id, cohort.id));
    expect(outcomes.map((o) => o.outcome)).toEqual([
      'enrolled',
      'enrolled',
      'waitlisted',
      'waitlisted',
    ]);
    expect(outcomes.map((o) => o.enrollment.waitlistPosition)).toEqual([null, null, 1, 2]);
    expect(await cohortNow(cohort.id)).toMatchObject({
      enrolledCount: 2,
      waitlistCount: 2,
      seatsLeft: 0,
    });
  });

  it('gives a freed seat to the longest-waiting student', async () => {
    const cohort = await openCohort({ maxSize: 1 });
    const [s1, s2, s3] = await Promise.all([nextStudent(), nextStudent(), nextStudent()]);
    const enrolled = await enrollOk(s1.id, cohort.id);
    const second = await enrollOk(s2.id, cohort.id);
    const third = await enrollOk(s3.id, cohort.id);
    expect([second.enrollment.waitlistPosition, third.enrollment.waitlistPosition]).toEqual([1, 2]);

    const bad = await asBoleDesk(
      'POST',
      `/enrollments/${enrolled.enrollment.id}/withdraw`,
      { reasonCode: 'made_up' },
      ifMatch(enrolled.enrollment.version),
    );
    expect(code(bad)).toBe('INVALID_LIST_VALUE');
    expect(
      (
        await asBoleDesk('POST', `/enrollments/${enrolled.enrollment.id}/withdraw`, {
          reasonCode: 'financial',
        })
      ).statusCode,
    ).toBe(428);

    const res = await asBoleDesk(
      'POST',
      `/enrollments/${enrolled.enrollment.id}/withdraw`,
      { reasonCode: 'financial' },
      ifMatch(enrolled.enrollment.version),
    );
    expect(res.statusCode, res.body).toBe(200);
    const result = withdrawResponseSchema.parse(res.json());
    expect(result.enrollment).toMatchObject({ status: 'withdrawn', withdrawalReason: 'financial' });
    expect(result.promoted).toMatchObject({
      id: second.enrollment.id,
      status: 'active',
      waitlistPosition: null,
    });

    // The last student moves up to first in line, and the class stays exactly full.
    const waiting = await roster(cohort.id, 'waitlisted');
    expect(waiting.map((e) => [e.id, e.waitlistPosition])).toEqual([[third.enrollment.id, 1]]);
    expect(await cohortNow(cohort.id)).toMatchObject({ enrolledCount: 1, seatsLeft: 0 });

    // Withdrawing from the waitlist frees no seat and promotes nobody.
    const leave = await asBoleDesk(
      'POST',
      `/enrollments/${third.enrollment.id}/withdraw`,
      { reasonCode: 'financial' },
      ifMatch(third.enrollment.version),
    );
    expect(withdrawResponseSchema.parse(leave.json()).promoted).toBeNull();
    const twice = await asBoleDesk(
      'POST',
      `/enrollments/${third.enrollment.id}/withdraw`,
      { reasonCode: 'financial' },
      ifMatch(third.enrollment.version + 1),
    );
    expect(code(twice)).toBe('INVALID_ENROLLMENT_STATE');
  });

  it('lets a withdrawn student come back later', async () => {
    const cohort = await openCohort();
    const student = await nextStudent();
    const first = await enrollOk(student.id, cohort.id);
    await asBoleDesk(
      'POST',
      `/enrollments/${first.enrollment.id}/withdraw`,
      { reasonCode: 'financial' },
      ifMatch(first.enrollment.version),
    );
    expect((await enrollOk(student.id, cohort.id)).outcome).toBe('enrolled');
  });

  it('finishes the application when the student gets a seat', async () => {
    const cohort = await openCohort();
    const applied = await asBoleDesk(
      'POST',
      '/applications',
      {
        givenName: 'Applied',
        fatherName: 'Enroller',
        gender: 'male',
        phone: '0966000001',
        branchId: bole.id,
      },
      key(),
    );
    const application = applicationSchema.parse(applied.json());
    const offered = applicationSchema.parse(
      (
        await asBoleDesk(
          'POST',
          `/applications/${application.id}/transition`,
          { to: 'offered' },
          ifMatch(application.version),
        )
      ).json(),
    );
    const converted = convertResponseSchema.parse(
      (
        await asBoleDesk(
          'POST',
          `/applications/${application.id}/convert`,
          {},
          { ...ifMatch(offered.version), ...key() },
        )
      ).json(),
    );
    expect((await enrollOk(converted.student.id, cohort.id)).outcome).toBe('enrolled');
    const after = applicationSchema.parse(
      (await asBoleDesk('GET', `/applications/${application.id}`)).json(),
    );
    expect(after.status).toBe('enrolled');
  });
});

describe('seats under pressure', () => {
  it('gives the last seat to exactly one of 50 simultaneous requests', async () => {
    const cohort = await openCohort({ roomId: smallRoom.id, maxSize: 10 });
    for (let i = 0; i < 9; i += 1) await enrollOk((await nextStudent()).id, cohort.id);
    expect((await cohortNow(cohort.id)).seatsLeft).toBe(1);

    const contenders = await Promise.all(Array.from({ length: 50 }, () => nextStudent()));
    const results = await Promise.all(contenders.map((s) => enroll(s.id, cohort.id)));
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const outcomes = results.map((r) => enrollResponseSchema.parse(r.json()).outcome);
    expect(outcomes.filter((o) => o === 'enrolled')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'waitlisted')).toHaveLength(49);

    expect(await cohortNow(cohort.id)).toMatchObject({
      enrolledCount: 10,
      waitlistCount: 49,
      seatsLeft: 0,
    });
    // Everyone in the queue has their own place, 1 to 49.
    const positions = (await roster(cohort.id, 'waitlisted'))
      .map((e) => e.waitlistPosition)
      .sort((a, b) => Number(a) - Number(b));
    expect(positions).toEqual(Array.from({ length: 49 }, (_, i) => i + 1));
  });

  it('keeps the class exactly full while people withdraw and enroll at the same time', async () => {
    const cohort = await openCohort({ roomId: smallRoom.id, maxSize: 6 });
    const seated = [];
    for (let i = 0; i < 6; i += 1) seated.push(await enrollOk((await nextStudent()).id, cohort.id));
    const waiting = await Promise.all(Array.from({ length: 4 }, () => nextStudent()));
    for (const s of waiting) await enrollOk(s.id, cohort.id);
    const newcomers = await Promise.all(Array.from({ length: 8 }, () => nextStudent()));

    const leavers = seated.slice(0, 3);
    await Promise.all([
      ...leavers.map((l) =>
        asBoleDesk(
          'POST',
          `/enrollments/${l.enrollment.id}/withdraw`,
          { reasonCode: 'financial' },
          ifMatch(l.enrollment.version),
        ),
      ),
      ...newcomers.map((s) => enroll(s.id, cohort.id)),
    ]);

    const now = await cohortNow(cohort.id);
    // Never over capacity, never a seat left empty while people are waiting.
    expect(now.enrolledCount).toBe(6);
    expect(now.waitlistCount).toBe(4 + 8 - 3);
    const queue = (await roster(cohort.id, 'waitlisted'))
      .map((e) => e.waitlistPosition)
      .sort((a, b) => Number(a) - Number(b));
    expect(queue).toEqual(Array.from({ length: now.waitlistCount }, (_, i) => i + 1));
  });
});

describe('prerequisites, results and completion', () => {
  it('needs the prerequisite course completed first', async () => {
    const a1Cohort = await openCohort({ courseId: a1.id });
    const a2Cohort = await openCohort({ courseId: a2.id });
    const student = await nextStudent();

    const early = await enroll(student.id, a2Cohort.id);
    expect(early.statusCode).toBe(422);
    expect(code(early)).toBe('PREREQUISITES_NOT_MET');

    const inA1 = await enrollOk(student.id, a1Cohort.id);
    // Still not done: being enrolled in A1 isn't enough.
    expect(code(await enroll(student.id, a2Cohort.id))).toBe('PREREQUISITES_NOT_MET');
    const done = await asAdmin(
      'POST',
      `/enrollments/${inA1.enrollment.id}/result`,
      {},
      ifMatch(inA1.enrollment.version),
    );
    expect(enrollmentSchema.parse(done.json()).status).toBe('completed');
    expect((await enrollOk(student.id, a2Cohort.id)).outcome).toBe('enrolled');
    // A completed course can't be taken again in the same cohort.
    expect(code(await enroll(student.id, a1Cohort.id))).toBe('ALREADY_ENROLLED');
  });

  it('applies the completion rules to decide pass or fail', async () => {
    const cohort = await openCohort({ courseId: a2.id });
    const seatStudent = async () => {
      const student = await nextStudent();
      // Make the student eligible for A2 by completing A1.
      const a1Cohort = await openCohort({ courseId: a1.id });
      const inA1 = await enrollOk(student.id, a1Cohort.id);
      await asAdmin(
        'POST',
        `/enrollments/${inA1.enrollment.id}/result`,
        {},
        ifMatch(inA1.enrollment.version),
      );
      return enrollOk(student.id, cohort.id);
    };
    const record = (
      e: { enrollment: { id: string; version: number } },
      body: object,
      who = asAdmin,
    ) => who('POST', `/enrollments/${e.enrollment.id}/result`, body, ifMatch(e.enrollment.version));

    const passer = await seatStudent();
    const missing = await record(passer, { score: 70 });
    expect(missing.statusCode).toBe(422);
    expect(code(missing)).toBe('RESULT_INCOMPLETE');
    expect(problemDetailsSchema.parse(missing.json()).detail).toContain('attendance');

    const passed = enrollmentSchema.parse(
      (await record(passer, { score: 60, attendancePercent: 80 })).json(),
    );
    expect(passed).toMatchObject({ status: 'completed', score: 60, attendancePercent: 80 });
    expect(passed.completedAt).not.toBeNull();

    const failer = await seatStudent();
    const failed = enrollmentSchema.parse(
      (await record(failer, { score: 55, attendancePercent: 95 })).json(),
    );
    expect(failed.status).toBe('failed');

    // Only enrolled students get results, and only by someone allowed to.
    const again = await record(passer, { score: 90, attendancePercent: 90 });
    expect(code(again)).toBe('INVALID_ENROLLMENT_STATE');
    const third = await seatStudent();
    expect((await record(third, { score: 90, attendancePercent: 90 }, asBoleDesk)).statusCode).toBe(
      403,
    );
    const py = await openCohort({ courseId: py1.id });
    const pyStudent = await enrollOk((await nextStudent()).id, py.id);
    expect((await record(pyStudent, {}, asLanguageCoordinator)).statusCode).toBe(403);
    expect(
      (await record(third, { score: 90, attendancePercent: 90 }, asLanguageCoordinator)).statusCode,
    ).toBe(200);

    // A finished cohort can be completed once nobody is still enrolled.
    const status = cohortSchema.parse((await asAdmin('GET', `/cohorts/${cohort.id}`)).json());
    expect(status.enrolledCount).toBe(0);
  });

  it('keeps names and contact details out of the audit log', async () => {
    const cohort = await openCohort();
    const student = await nextStudent();
    const enrolled = await enrollOk(student.id, cohort.id);
    const audit = auditListResponseSchema.parse(
      (
        await asAdmin(
          'GET',
          `/audit-log?action=enrollment.created&entityId=${enrolled.enrollment.id}`,
        )
      ).json(),
    );
    const text = JSON.stringify(audit.items[0]?.changes);
    expect(text).toContain(student.studentNumber);
    expect(text).not.toContain(student.givenName);
    expect(text).not.toContain(student.phone);
  });
});
