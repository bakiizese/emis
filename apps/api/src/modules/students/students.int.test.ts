import { randomUUID } from 'node:crypto';

import {
  applicationListResponseSchema,
  applicationSchema,
  auditListResponseSchema,
  branchSchema,
  convertResponseSchema,
  courseSchema,
  customFieldDefinitionSchema,
  departmentSchema,
  duplicateListResponseSchema,
  problemDetailsSchema,
  programSchema,
  studentListResponseSchema,
  studentSchema,
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

// Own database: student numbers and application references are counted from 1 here.
let urls: TestDatabaseUrls;
let app: NestFastifyApplication;
let asAdmin: ReturnType<typeof callAs>;
let asBoleDesk: ReturnType<typeof callAs>;
let asLanguageCoordinator: ReturnType<typeof callAs>;

let bole: { id: string };
let piassa: { id: string };
let languageCourse: { id: string; version: number };
let computerCourse: { id: string };

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

let phoneCounter = 0;
/** A valid, unique Ethiopian mobile number per call. */
const nextPhone = () => `09${String(10_000_000 + ++phoneCounter)}`;

const person = (overrides: Record<string, unknown> = {}) => ({
  givenName: 'Hana',
  fatherName: 'Bekele',
  grandfatherName: 'Tadesse',
  gender: 'female',
  phone: nextPhone(),
  branchId: bole.id,
  customFields: { employer: 'Ethio Telecom' },
  ...overrides,
});

/** Test data that just needs to exist: skips the duplicate check, which has its own tests. */
const bulkStudent = (overrides: Record<string, unknown> = {}, who = asBoleDesk) =>
  who('POST', '/students', person({ confirmNotDuplicate: true, ...overrides }), key());

const createStudent = (overrides: Record<string, unknown> = {}, who = asBoleDesk) =>
  who('POST', '/students', person(overrides), key());

beforeAll(async () => {
  urls = await createIsolatedDatabase(inject('database'), 'emis_students_test');
  app = await createTestApp({ env: { DATABASE_URL: urls.appUrl, RATE_LIMIT_MAX: '10000' } });
  const admin = await createStaff(app, { email: 'students-admin@lingua.test', roleKey: 'admin' });
  asAdmin = callAs(app, admin);

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
  languageCourse = await post(
    asAdmin,
    '/courses',
    { programId: english.id, code: 'A2', name: 'English A2', levelOrder: 2 },
    courseSchema,
  );
  computerCourse = await post(
    asAdmin,
    '/courses',
    { programId: python.id, code: 'PY1', name: 'Python 1' },
    courseSchema,
  );

  for (const [namespace, codes] of [
    ['student_category', ['regular', 'scholarship']],
    ['lead_source', ['walk_in', 'website']],
  ] as const) {
    for (const value of codes) {
      await post(
        asAdmin,
        '/descriptors',
        { namespace, code: value, label: value },
        { parse: (v) => v },
      );
    }
  }
  await post(
    asAdmin,
    '/custom-fields',
    {
      entityType: 'student',
      key: 'employer',
      label: 'Employer',
      fieldType: 'text',
      required: true,
    },
    customFieldDefinitionSchema,
  );

  const desk = await createStaff(app, { email: 'students-desk@lingua.test' });
  await grantRole(desk, 'secretary', { type: 'branch', id: bole.id });
  asBoleDesk = callAs(app, desk);
  const coordinator = await createStaff(app, { email: 'students-coord@lingua.test' });
  await grantRole(coordinator, 'coordinator', { type: 'department', id: language.id });
  asLanguageCoordinator = callAs(app, coordinator);
});
afterAll(() => app.close());

describe('registering students', () => {
  it('numbers the student, tidies the phone and stores guardians', async () => {
    const res = await createStudent({
      phone: '0911 22 33 44',
      categoryCode: 'regular',
      guardians: [
        { name: 'Bekele Tadesse', relationship: 'Father', phone: '0922334455', isPrimary: true },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    const student = studentSchema.parse(res.json());
    expect(student).toMatchObject({
      phone: '+251911223344',
      status: 'active',
      categoryCode: 'regular',
      studentNumber: expect.stringMatching(/^STU-\d{4}-00001$/) as string,
      customFields: { employer: 'Ethio Telecom' },
    });
    expect(student.guardians).toMatchObject([{ phone: '+251922334455', isPrimary: true }]);
  });

  it('refuses invalid custom values, categories and branches', async () => {
    const missing = await createStudent({ customFields: {} });
    expect(missing.statusCode).toBe(400);
    expect(problemDetailsSchema.parse(missing.json()).errors?.[0]?.path).toBe(
      'customFields.employer',
    );

    const category = await createStudent({ categoryCode: 'vip' });
    expect(category.statusCode).toBe(422);
    expect(code(category)).toBe('INVALID_LIST_VALUE');

    const ghost = await asAdmin(
      'POST',
      '/students',
      person({ branchId: '0199a1b2-0000-7000-8000-000000000000' }),
      key(),
    );
    expect(ghost.statusCode).toBe(422);
    expect(code(ghost)).toBe('BRANCH_NOT_FOUND');
  });

  it('needs an Idempotency-Key and replays a retried request', async () => {
    expect((await asBoleDesk('POST', '/students', person())).statusCode).toBe(400);

    const idem = randomUUID();
    const body = person({ givenName: 'Retry', fatherName: 'Twice' });
    const first = await asBoleDesk('POST', '/students', body, { 'idempotency-key': idem });
    const second = await asBoleDesk('POST', '/students', body, { 'idempotency-key': idem });
    expect(first.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    const found = studentListResponseSchema.parse(
      (await asBoleDesk('GET', '/students?q=twice')).json(),
    );
    expect(found.items).toHaveLength(1);
  });

  it('gives every student a different number when many register at once', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        bulkStudent({
          givenName: `Parallel${String.fromCharCode(97 + i)}`,
          fatherName: 'Zeleke',
        }),
      ),
    );
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const numbers = results.map((r) => studentSchema.parse(r.json()).studentNumber).sort();
    expect(new Set(numbers).size).toBe(12);
    // Consecutive: no gaps in the sequence.
    const sequence = numbers.map((n) => Number(n.split('-')[2])).sort((a, b) => a - b);
    expect(sequence[sequence.length - 1]! - sequence[0]!).toBe(11);
  });
});

describe('possible duplicates', () => {
  it('stops a second registration with the same phone or a near-identical name', async () => {
    const original = studentSchema.parse(
      (
        await createStudent({
          givenName: 'Almaz',
          fatherName: 'Worku',
          grandfatherName: 'Desta',
          phone: '0933000111',
        })
      ).json(),
    );

    const samePhone = await createStudent({
      givenName: 'Someone',
      fatherName: 'Else',
      phone: '+251 933 000 111',
    });
    expect(samePhone.statusCode).toBe(409);
    expect(code(samePhone)).toBe('DUPLICATE_STUDENT_SUSPECTED');

    const similar = await createStudent({
      givenName: 'Almaz',
      fatherName: 'Worku',
      grandfatherName: 'Desta',
    });
    expect(similar.statusCode).toBe(409);
    // A typo in the spelling still counts.
    const typo = await createStudent({
      givenName: 'Almaz',
      fatherName: 'Wroku',
      grandfatherName: 'Desta',
    });
    expect(typo.statusCode).toBe(409);

    const list = duplicateListResponseSchema.parse(
      (
        await asBoleDesk(
          'GET',
          '/students/duplicates?givenName=Almaz&fatherName=Worku&phone=0933000111',
        )
      ).json(),
    );
    expect(list.items[0]).toMatchObject({
      student: { id: original.id, studentNumber: original.studentNumber },
      reasons: expect.arrayContaining(['same_phone', 'similar_name']) as string[],
    });

    // A genuinely different person goes straight through.
    expect((await createStudent({ givenName: 'Dawit', fatherName: 'Kebede' })).statusCode).toBe(
      201,
    );
  });

  it('lets someone confirm that a match is a different person', async () => {
    await createStudent({
      givenName: 'Meron',
      fatherName: 'Alemu',
      grandfatherName: 'Haile',
      phone: '0933000222',
    });
    const twin = { givenName: 'Meron', fatherName: 'Alemu', grandfatherName: 'Haile' };
    expect((await createStudent(twin)).statusCode).toBe(409);
    const confirmed = await createStudent({ ...twin, confirmNotDuplicate: true });
    expect(confirmed.statusCode).toBe(201);
  });

  it('spots a duplicate registered at another branch', async () => {
    await createStudent(
      { givenName: 'Selam', fatherName: 'Girma', phone: '0933000333', branchId: piassa.id },
      asAdmin,
    );
    const res = await createStudent({ givenName: 'Selam', fatherName: 'Girma' });
    expect(res.statusCode).toBe(409);
  });
});

describe('finding students', () => {
  beforeAll(async () => {
    await bulkStudent({ givenName: 'Tigist', fatherName: 'Haile', phone: '0944555666' });
    for (const n of ['One', 'Two', 'Three', 'Four', 'Five']) {
      await bulkStudent({ givenName: `Page${n}`, fatherName: 'Testing' });
    }
  });

  it('matches name words in any order, the student number, or part of the phone', async () => {
    const byName = studentListResponseSchema.parse(
      (await asBoleDesk('GET', '/students?q=haile tig')).json(),
    );
    expect(byName.items.map((s) => s.givenName)).toContain('Tigist');
    const byPhone = studentListResponseSchema.parse(
      (await asBoleDesk('GET', '/students?q=0944 555')).json(),
    );
    expect(byPhone.items.map((s) => s.givenName)).toEqual(['Tigist']);
    const number = byName.items.find((s) => s.givenName === 'Tigist')!.studentNumber;
    const byNumber = studentListResponseSchema.parse(
      (await asBoleDesk('GET', `/students?q=${number}`)).json(),
    );
    expect(byNumber.items).toHaveLength(1);
  });

  it('treats search text literally, not as a pattern', async () => {
    const res = await asBoleDesk('GET', '/students?q=%25');
    expect(studentListResponseSchema.parse(res.json()).items).toHaveLength(0);
  });

  it('pages through the list without repeats', async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await asBoleDesk(
        'GET',
        `/students?q=testing&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      );
      const page = studentListResponseSchema.parse(res.json());
      for (const s of page.items) {
        expect(seen.has(s.id)).toBe(false);
        seen.add(s.id);
      }
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(seen.size).toBe(5);
    expect(pages).toBe(3);
  });
});

describe('branch limits', () => {
  it('keeps a branch Secretary to their own branch', async () => {
    const otherBranch = await bulkStudent(
      { givenName: 'Abel', fatherName: 'Piassa', branchId: piassa.id },
      asAdmin,
    );
    const elsewhere = studentSchema.parse(otherBranch.json());

    const denied = await createStudent({
      givenName: 'Nope',
      fatherName: 'Branch',
      branchId: piassa.id,
    });
    expect(denied.statusCode).toBe(403);
    expect((await asBoleDesk('GET', `/students/${elsewhere.id}`)).statusCode).toBe(403);
    expect(
      (
        await asBoleDesk(
          'PATCH',
          `/students/${elsewhere.id}`,
          { city: 'Addis' },
          ifMatch(elsewhere.version),
        )
      ).statusCode,
    ).toBe(403);

    const mine = studentListResponseSchema.parse(
      (await asBoleDesk('GET', '/students?limit=100')).json(),
    );
    expect(mine.items.every((s) => s.branchId === bole.id)).toBe(true);
    const all = studentListResponseSchema.parse(
      (await asAdmin('GET', '/students?limit=100')).json(),
    );
    expect(all.items.some((s) => s.branchId === piassa.id)).toBe(true);
  });

  it('lets a department Coordinator read students but not change them', async () => {
    expect((await asLanguageCoordinator('GET', '/students')).statusCode).toBe(200);
    expect(
      (await createStudent({ givenName: 'Coord', fatherName: 'Try' }, asLanguageCoordinator))
        .statusCode,
    ).toBe(403);
  });
});

describe('editing students', () => {
  it('changes only what was sent, guards against stale edits, and audits without personal data', async () => {
    const student = studentSchema.parse(
      (
        await createStudent({
          givenName: 'Edit',
          fatherName: 'Me',
          email: 'edit@lingua.test',
          city: 'Adama',
        })
      ).json(),
    );
    expect(
      (await asBoleDesk('PATCH', `/students/${student.id}`, { city: 'Addis' })).statusCode,
    ).toBe(428);
    expect(
      (
        await asBoleDesk(
          'PATCH',
          `/students/${student.id}`,
          { city: 'Addis' },
          ifMatch(student.version + 3),
        )
      ).statusCode,
    ).toBe(412);

    const res = await asBoleDesk(
      'PATCH',
      `/students/${student.id}`,
      { city: 'Addis', status: 'on_hold' },
      ifMatch(student.version),
    );
    expect(studentSchema.parse(res.json())).toMatchObject({
      city: 'Addis',
      status: 'on_hold',
      email: 'edit@lingua.test',
      grandfatherName: 'Tadesse',
      version: student.version + 1,
    });

    const audit = auditListResponseSchema.parse(
      (await asAdmin('GET', `/audit-log?action=student.updated&entityId=${student.id}`)).json(),
    );
    expect(audit.items[0]?.changes).toMatchObject({
      fields: ['city', 'status'],
      status: { from: 'active', to: 'on_hold' },
    });
    expect(JSON.stringify(audit.items[0]?.changes)).not.toContain('Addis');
    const registered = auditListResponseSchema.parse(
      (await asAdmin('GET', `/audit-log?action=student.registered&entityId=${student.id}`)).json(),
    );
    expect(JSON.stringify(registered.items[0]?.changes)).not.toContain('edit@lingua.test');
  });

  it('replaces guardians and allows one primary contact and one payer', async () => {
    const student = studentSchema.parse(
      (await bulkStudent({ givenName: 'Guard', fatherName: 'Ian' })).json(),
    );
    const father = {
      name: 'Bekele Tadesse',
      relationship: 'Father',
      phone: '0911000001',
      isPrimary: true,
      isPayer: true,
    };
    const mother = { name: 'Almaz Worku', relationship: 'Mother', phone: '0911000002' };

    const set = await asBoleDesk(
      'PUT',
      `/students/${student.id}/guardians`,
      { guardians: [father, mother] },
      ifMatch(student.version),
    );
    expect(set.statusCode, set.body).toBe(200);
    const updated = studentSchema.parse(set.json());
    expect(updated.guardians.map((g) => g.name)).toEqual(['Bekele Tadesse', 'Almaz Worku']);
    expect(updated.version).toBe(student.version + 1);

    const twoPrimary = await asBoleDesk(
      'PUT',
      `/students/${student.id}/guardians`,
      { guardians: [father, { ...mother, isPrimary: true }] },
      ifMatch(updated.version),
    );
    expect(twoPrimary.statusCode).toBe(400);

    const replaced = await asBoleDesk(
      'PUT',
      `/students/${student.id}/guardians`,
      { guardians: [mother] },
      ifMatch(updated.version),
    );
    expect(studentSchema.parse(replaced.json()).guardians).toHaveLength(1);
    expect(
      (
        await asBoleDesk(
          'PUT',
          `/students/${student.id}/guardians`,
          { guardians: [] },
          ifMatch(updated.version),
        )
      ).statusCode,
    ).toBe(412);
  });
});

describe('admissions pipeline', () => {
  const applicant = (overrides: Record<string, unknown> = {}) => ({
    ...person({ givenName: 'Kaleb', fatherName: 'Mulugeta' }),
    source: 'walk_in',
    desiredCourseId: languageCourse.id,
    ...overrides,
  });
  const create = async (overrides: Record<string, unknown> = {}, who = asBoleDesk) =>
    applicationSchema.parse(
      (
        await (async () => {
          const res = await who('POST', '/applications', applicant(overrides), key());
          expect(res.statusCode, res.body).toBe(201);
          return res;
        })()
      ).json(),
    );
  const move = (id: string, to: string, version: number, who = asBoleDesk) =>
    who('POST', `/applications/${id}/transition`, { to }, ifMatch(version));

  it('registers a walk-in with a reference number', async () => {
    const application = await create();
    expect(application).toMatchObject({
      status: 'submitted',
      reference: expect.stringMatching(/^APP-\d{4}-\d{4}$/) as string,
      source: 'walk_in',
      placement: null,
      studentId: null,
    });

    const badSource = await asBoleDesk(
      'POST',
      '/applications',
      applicant({ source: 'billboard' }),
      key(),
    );
    expect(code(badSource)).toBe('INVALID_LIST_VALUE');
    const badCourse = await asBoleDesk(
      'POST',
      '/applications',
      applicant({ desiredCourseId: '0199a1b2-0000-7000-8000-000000000000' }),
      key(),
    );
    expect(badCourse.statusCode).toBe(422);
    expect(code(badCourse)).toBe('REFERENCE_NOT_FOUND');
  });

  it('only follows the allowed steps', async () => {
    const application = await create();
    const contacted = applicationSchema.parse(
      (await move(application.id, 'contacted', application.version)).json(),
    );
    expect(contacted.status).toBe('contacted');
    expect(contacted.version).toBe(application.version + 1);

    // Stages reached some other way can't be chosen by hand.
    for (const to of ['placed', 'confirmed', 'enrolled']) {
      expect((await move(application.id, to, contacted.version)).statusCode).toBe(400);
    }
    const stale = await move(application.id, 'offered', application.version);
    expect(stale.statusCode).toBe(412);

    const offered = applicationSchema.parse(
      (await move(application.id, 'offered', contacted.version)).json(),
    );
    const back = await move(application.id, 'placement_scheduled', offered.version);
    expect(back.statusCode).toBe(409);
    expect(code(back)).toBe('INVALID_TRANSITION');

    const rejected = applicationSchema.parse(
      (await move(application.id, 'rejected', offered.version)).json(),
    );
    const reopen = await move(application.id, 'contacted', rejected.version);
    expect(code(reopen)).toBe('INVALID_TRANSITION');
    const edit = await asBoleDesk(
      'PATCH',
      `/applications/${application.id}`,
      { notes: 'late' },
      ifMatch(rejected.version),
    );
    expect(edit.statusCode).toBe(409);
    expect(code(edit)).toBe('APPLICATION_CLOSED');
  });

  it('records placement into the right department and keeps the score in range', async () => {
    const application = await create();
    const place = (who: ReturnType<typeof callAs>, body: object, version: number) =>
      who('POST', `/applications/${application.id}/placement`, body, ifMatch(version));

    expect(
      (
        await place(
          asBoleDesk,
          { score: 120, recommendedCourseId: languageCourse.id },
          application.version,
        )
      ).statusCode,
    ).toBe(400);
    // A Language Coordinator can place into Language, not Computer.
    expect(
      (
        await place(
          asLanguageCoordinator,
          { score: 70, recommendedCourseId: computerCourse.id },
          application.version,
        )
      ).statusCode,
    ).toBe(403);
    const placed = await place(
      asLanguageCoordinator,
      { score: 72.5, recommendedCourseId: languageCourse.id, notes: 'Solid grammar' },
      application.version,
    );
    expect(placed.statusCode, placed.body).toBe(200);
    const result = applicationSchema.parse(placed.json());
    expect(result).toMatchObject({
      status: 'placed',
      placement: { score: 72.5, recommendedCourseId: languageCourse.id, notes: 'Solid grammar' },
    });

    // A retest replaces the result; after an offer it's too late.
    const retest = await place(
      asBoleDesk,
      { score: 80, recommendedCourseId: languageCourse.id },
      result.version,
    );
    expect(applicationSchema.parse(retest.json()).placement?.score).toBe(80);
    const offered = applicationSchema.parse(
      (await move(application.id, 'offered', result.version + 1)).json(),
    );
    const late = await place(
      asBoleDesk,
      { score: 90, recommendedCourseId: languageCourse.id },
      offered.version,
    );
    expect(code(late)).toBe('PLACEMENT_NOT_ALLOWED');
  });

  it('answers 404 for placement while the module is off', async () => {
    const application = await create();
    expect((await asAdmin('PUT', '/modules/placement', { enabled: false })).statusCode).toBe(200);
    const res = await asBoleDesk(
      'POST',
      `/applications/${application.id}/placement`,
      { score: 50, recommendedCourseId: languageCourse.id },
      ifMatch(application.version),
    );
    expect(res.statusCode).toBe(404);
    expect(code(res)).toBe('MODULE_DISABLED');
    const scheduling = await move(application.id, 'placement_scheduled', application.version);
    expect(code(scheduling)).toBe('PLACEMENT_DISABLED');
    await asAdmin('PUT', '/modules/placement', { enabled: true });
  });

  it('registers an offered applicant as a student, once', async () => {
    const application = await create({
      givenName: 'Yonas',
      fatherName: 'Getachew',
      phone: '0955000001',
    });
    const notReady = await asBoleDesk(
      'POST',
      `/applications/${application.id}/convert`,
      {},
      { ...ifMatch(application.version), ...key() },
    );
    expect(code(notReady)).toBe('NOT_READY_TO_CONVERT');

    const offered = applicationSchema.parse(
      (await move(application.id, 'offered', application.version)).json(),
    );
    const res = await asBoleDesk(
      'POST',
      `/applications/${application.id}/convert`,
      { categoryCode: 'regular', customFields: { employer: 'Dashen Bank' } },
      { ...ifMatch(offered.version), ...key() },
    );
    expect(res.statusCode, res.body).toBe(200);
    const converted = convertResponseSchema.parse(res.json());
    expect(converted.application).toMatchObject({
      status: 'confirmed',
      studentId: converted.student.id,
    });
    expect(converted.student).toMatchObject({
      givenName: 'Yonas',
      phone: '+251955000001',
      categoryCode: 'regular',
      branchId: bole.id,
    });

    const again = await asBoleDesk(
      'POST',
      `/applications/${application.id}/convert`,
      {},
      { ...ifMatch(converted.application.version), ...key() },
    );
    expect(again.statusCode).toBe(409);
    expect(code(again)).toBe('ALREADY_CONVERTED');
  });

  it('registers only one student when the button is pressed twice at once', async () => {
    const application = await create({
      givenName: 'Double',
      fatherName: 'Click',
      phone: '0955000002',
    });
    const offered = applicationSchema.parse(
      (await move(application.id, 'offered', application.version)).json(),
    );
    const results = await Promise.all(
      [1, 2].map(() =>
        asBoleDesk(
          'POST',
          `/applications/${application.id}/convert`,
          { customFields: { employer: 'Awash Bank' } },
          { ...ifMatch(offered.version), ...key() },
        ),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const found = studentListResponseSchema.parse(
      (await asBoleDesk('GET', '/students?q=double click')).json(),
    );
    expect(found.items).toHaveLength(1);
  });

  it('stops a duplicate student and offers linking to the existing one', async () => {
    const existing = studentSchema.parse(
      (
        await createStudent({ givenName: 'Existing', fatherName: 'Person', phone: '0955000003' })
      ).json(),
    );
    const application = await create({
      givenName: 'Existing',
      fatherName: 'Person',
      phone: '0955000003',
    });
    const offered = applicationSchema.parse(
      (await move(application.id, 'offered', application.version)).json(),
    );

    const matches = duplicateListResponseSchema.parse(
      (await asBoleDesk('GET', `/applications/${application.id}/duplicates`)).json(),
    );
    expect(matches.items[0]?.student.id).toBe(existing.id);

    const blocked = await asBoleDesk(
      'POST',
      `/applications/${application.id}/convert`,
      { customFields: { employer: 'Zemen Bank' } },
      { ...ifMatch(offered.version), ...key() },
    );
    expect(blocked.statusCode).toBe(409);
    expect(code(blocked)).toBe('DUPLICATE_STUDENT_SUSPECTED');

    const linked = await asBoleDesk(
      'POST',
      `/applications/${application.id}/convert`,
      { existingStudentId: existing.id },
      { ...ifMatch(offered.version), ...key() },
    );
    expect(linked.statusCode, linked.body).toBe(200);
    expect(convertResponseSchema.parse(linked.json()).student.id).toBe(existing.id);
    const total = studentListResponseSchema.parse(
      (await asBoleDesk('GET', '/students?q=existing person')).json(),
    );
    expect(total.items).toHaveLength(1);
  });

  it('filters the queue by stage, status, search and branch', async () => {
    const open = await create({ givenName: 'Queue', fatherName: 'Open' });
    const closed = await create({ givenName: 'Queue', fatherName: 'Closed' });
    await move(closed.id, 'withdrawn', closed.version);

    const list = async (query: string, who = asBoleDesk) =>
      applicationListResponseSchema.parse((await who('GET', `/applications?${query}`)).json())
        .items;
    expect((await list('q=queue&stage=open')).map((a) => a.id)).toEqual([open.id]);
    expect((await list('q=queue&stage=closed')).map((a) => a.id)).toEqual([closed.id]);
    expect((await list('status=withdrawn&q=queue')).map((a) => a.id)).toEqual([closed.id]);
    expect((await list(`q=${open.reference}`)).map((a) => a.id)).toEqual([open.id]);

    // The Bole Secretary never sees Piassa's applicants.
    const piassaApplicant = await create(
      { givenName: 'Queue', fatherName: 'Piassa', branchId: piassa.id },
      asAdmin,
    );
    expect((await list('q=queue')).some((a) => a.id === piassaApplicant.id)).toBe(false);
    expect((await list('q=queue', asAdmin)).some((a) => a.id === piassaApplicant.id)).toBe(true);
    expect((await asBoleDesk('GET', `/applications/${piassaApplicant.id}`)).statusCode).toBe(403);
    expect((await move(piassaApplicant.id, 'contacted', piassaApplicant.version)).statusCode).toBe(
      403,
    );
  });

  it('keeps applicant details out of the audit log', async () => {
    const application = await create({
      givenName: 'Private',
      fatherName: 'Person',
      phone: '0955000009',
    });
    await asBoleDesk(
      'PATCH',
      `/applications/${application.id}`,
      { notes: 'call after 5pm', city: 'Adama' },
      ifMatch(application.version),
    );
    const audit = auditListResponseSchema.parse(
      (await asAdmin('GET', `/audit-log?entityId=${application.id}`)).json(),
    );
    expect(audit.items.map((e) => e.action).sort()).toEqual([
      'application.created',
      'application.updated',
    ]);
    const text = JSON.stringify(audit.items.map((e) => e.changes));
    for (const secret of [
      'Private',
      'Person',
      '0955000009',
      '+251955000009',
      'Adama',
      'call after 5pm',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
