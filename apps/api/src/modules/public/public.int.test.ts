import { randomUUID } from 'node:crypto';

import {
  applicationListResponseSchema,
  branchSchema,
  cohortSchema,
  courseSchema,
  departmentSchema,
  enrollResponseSchema,
  problemDetailsSchema,
  preRegistrationResponseSchema,
  programSchema,
  publicCatalogResponseSchema,
  publicClassListResponseSchema,
  publicContactSchema,
  publicCourseDetailSchema,
  roomSchema,
  shiftSchema,
  studentSchema,
} from '@emis/contracts';
import { createIsolatedDatabase, type TestDatabaseUrls } from '@emis/db/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createTestAppWithMailer, type TestApp } from '../../testing/create-test-app.js';
import { callAs, createStaff } from '../../testing/staff-fixtures.js';

// Own database: switching modules off is global, and application numbers count from 1.
let urls: TestDatabaseUrls;
let mailApp: TestApp;
let app: NestFastifyApplication;
let asAdmin: ReturnType<typeof callAs>;
const anon = () => callAs(app, null);

let bole: { id: string };
let closedBranch: { id: string };
let evening: { id: string };
let morning: { id: string };
let a1: { id: string; version: number };
let a2: { id: string; version: number };
let hidden: { id: string; version: number };
let unpublishedCourse: { id: string };
let room: { id: string };
let openClassId: string;

const code = (res: LightMyRequestResponse) => problemDetailsSchema.parse(res.json()).code;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const key = () => ({ 'idempotency-key': randomUUID() });

async function post<T>(path: string, payload: object, schema: { parse: (v: unknown) => T }) {
  const res = await asAdmin('POST', path, payload, key());
  expect(res.statusCode, res.body).toBe(201);
  return schema.parse(res.json());
}

const todayAddis = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());
const plusDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Each class gets its own week so two classes never fight over the room. */
let week = 0;
const nextWeek = () => {
  const start = plusDays(todayAddis(), 14 + 7 * week++);
  return { startDate: start, endDate: plusDays(start, 4) };
};

async function makeClass(courseId: string, options: { open?: boolean; maxSize?: number } = {}) {
  const made = await post(
    '/cohorts',
    {
      name: `Class ${randomUUID().slice(0, 6)}`,
      courseId,
      shiftId: evening.id,
      roomId: room.id,
      maxSize: options.maxSize ?? 20,
      ...nextWeek(),
    },
    cohortSchema,
  );
  if (options.open === false) return made;
  const res = await asAdmin(
    'POST',
    `/cohorts/${made.id}/status`,
    { status: 'open' },
    ifMatch(made.version),
  );
  expect(res.statusCode, res.body).toBe(200);
  return cohortSchema.parse(res.json());
}

let visitor = 0;
/** A pre-registration from a distinct visitor (own IP), so the per-IP limit doesn't get in the way. */
const submit = (
  body: Record<string, unknown>,
  options: { idem?: string | null; ip?: string } = {},
) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/public/pre-registrations',
    remoteAddress: options.ip ?? `10.1.${Math.floor(++visitor / 250)}.${(visitor % 250) + 1}`,
    headers: options.idem === null ? {} : { 'idempotency-key': options.idem ?? randomUUID() },
    payload: body,
  });

let phoneCounter = 0;
const form = (overrides: Record<string, unknown> = {}) => ({
  givenName: 'Abebe',
  fatherName: 'Kebede',
  gender: 'male',
  phone: `09${String(50_000_000 + ++phoneCounter)}`,
  branchId: bole.id,
  desiredCourseId: a1.id,
  consent: true,
  ...overrides,
});

const queue = async (q: string) =>
  applicationListResponseSchema.parse((await asAdmin('GET', `/applications?q=${q}`)).json()).items;

beforeAll(async () => {
  urls = await createIsolatedDatabase(inject('database'), 'emis_public_test');
  mailApp = await createTestAppWithMailer({
    env: { DATABASE_URL: urls.appUrl, RATE_LIMIT_MAX: '100000' },
  });
  app = mailApp.app;
  asAdmin = callAs(
    app,
    await createStaff(app, { email: 'pub-admin@lingua.test', roleKey: 'admin' }),
  );

  await asAdmin(
    'PATCH',
    '/institution',
    {
      name: 'Lingua Institute',
      email: 'hello@lingua.test',
      phone: '+251911000000',
      address: 'Bole Road',
      city: 'Addis Ababa',
    },
    ifMatch(1),
  );

  const website = await asAdmin(
    'POST',
    '/descriptors',
    { namespace: 'lead_source', code: 'website', label: 'Website' },
    key(),
  );
  expect(website.statusCode, website.body).toBe(201);

  const language = await post('/departments', { code: 'LANG', name: 'Language' }, departmentSchema);
  const secret = await post('/departments', { code: 'SECR', name: 'Secret' }, departmentSchema);
  bole = await post('/branches', { code: 'BOLE', name: 'Bole' }, branchSchema);
  closedBranch = await post('/branches', { code: 'OLD', name: 'Old branch' }, branchSchema);
  await asAdmin('PATCH', `/branches/${closedBranch.id}`, { isActive: false }, ifMatch(1));

  const english = await post(
    '/programs',
    { departmentId: language.id, code: 'ENG', name: 'English', type: 'long_course' },
    programSchema,
  );
  await asAdmin(
    'PATCH',
    `/programs/${english.id}`,
    { isPublished: true },
    ifMatch(english.version),
  );
  const draft = await post(
    '/programs',
    { departmentId: secret.id, code: 'DRAFT', name: 'Draft program', type: 'short_course' },
    programSchema,
  );

  a1 = await post(
    '/courses',
    { programId: english.id, code: 'A1', name: 'English A1', durationWeeks: 12, totalHours: 96 },
    courseSchema,
  );
  a2 = await post(
    '/courses',
    { programId: english.id, code: 'A2', name: 'English A2', levelOrder: 2 },
    courseSchema,
  );
  hidden = await post(
    '/courses',
    { programId: english.id, code: 'OLD', name: 'Retired course' },
    courseSchema,
  );
  await asAdmin('PATCH', `/courses/${hidden.id}`, { isActive: false }, ifMatch(hidden.version));
  unpublishedCourse = await post(
    '/courses',
    { programId: draft.id, code: 'D1', name: 'Draft course' },
    courseSchema,
  );

  evening = await post(
    '/shifts',
    { code: 'EVE', name: 'Evening', daysOfWeek: [1, 3, 5], startTime: '17:00', endTime: '19:00' },
    shiftSchema,
  );
  morning = await post(
    '/shifts',
    { code: 'MOR', name: 'Morning', daysOfWeek: [2, 4], startTime: '08:00', endTime: '10:00' },
    shiftSchema,
  );
  room = await post(
    '/rooms',
    { branchId: bole.id, code: 'R1', name: 'R1', type: 'classroom', capacity: 30 },
    roomSchema,
  );
  openClassId = (await makeClass(a1.id)).id;
});

afterAll(async () => {
  await mailApp?.app.close();
});

describe('public catalog', () => {
  it('shows only what is published: active courses of published programs', async () => {
    const res = await anon()('GET', '/public/catalog');
    expect(res.statusCode, res.body).toBe(200);
    const { departments } = publicCatalogResponseSchema.parse(res.json());

    expect(departments.map((d) => d.name)).toEqual(['Language']);
    const [program] = departments[0]?.programs ?? [];
    expect(program?.name).toBe('English');
    expect(program?.courses.map((c) => c.code)).toEqual(['A1', 'A2']);
    expect(res.body).not.toContain('Retired course');
    expect(res.body).not.toContain('Draft');
  });

  it('exposes no internal fields', async () => {
    const res = await anon()('GET', '/public/catalog');
    for (const internal of [
      'prerequisiteIds',
      'minScore',
      'minAttendancePercent',
      'version',
      'isActive',
    ]) {
      expect(res.body, internal).not.toContain(`"${internal}"`);
    }
  });

  it('needs no session', async () => {
    expect((await anon()('GET', '/public/contact')).statusCode).toBe(200);
  });
});

describe('course pages and seats', () => {
  it('lists the joinable classes of a course with live seats and no headcounts', async () => {
    const res = await anon()('GET', `/public/courses/${a1.id}`);
    expect(res.statusCode, res.body).toBe(200);
    const detail = publicCourseDetailSchema.parse(res.json());

    expect(detail.course.name).toBe('English A1');
    expect(detail.program.name).toBe('English');
    expect(detail.department.name).toBe('Language');
    const cls = detail.classes.find((c) => c.id === openClassId);
    expect(cls).toMatchObject({
      seatsLeft: 20,
      isFull: false,
      shift: { name: 'Evening', startTime: '17:00' },
      branch: { name: 'Bole' },
    });
    expect(res.body).not.toContain('enrolledCount');
    expect(res.body).not.toContain('waitlistCount');
  });

  it('counts down as students enrol and flags a full class', async () => {
    const tiny = await makeClass(a2.id, { maxSize: 2 });
    for (let n = 1; n <= 2; n++) {
      const student = studentSchema.parse(
        (
          await asAdmin(
            'POST',
            '/students',
            {
              givenName: `Seat${n}`,
              fatherName: `Holder${String(n).padStart(3, '0')}`,
              gender: 'female',
              phone: `09${String(60_000_000 + n)}`,
              branchId: bole.id,
              confirmNotDuplicate: true,
            },
            key(),
          )
        ).json(),
      );
      const res = await asAdmin(
        'POST',
        '/enrollments',
        { studentId: student.id, cohortId: tiny.id },
        key(),
      );
      expect(res.statusCode, res.body).toBe(201);
      enrollResponseSchema.parse(res.json());

      const detail = publicCourseDetailSchema.parse(
        (await anon()('GET', `/public/courses/${a2.id}`)).json(),
      );
      const cls = detail.classes.find((c) => c.id === tiny.id);
      expect(cls?.seatsLeft).toBe(2 - n);
      expect(cls?.isFull).toBe(n === 2);
    }
  });

  it('leaves out classes that are not open or planned', async () => {
    const cancelled = await makeClass(a1.id, { open: false });
    const res = await asAdmin(
      'POST',
      `/cohorts/${cancelled.id}/status`,
      { status: 'cancelled' },
      ifMatch(cancelled.version),
    );
    expect(res.statusCode, res.body).toBe(200);

    const detail = publicCourseDetailSchema.parse(
      (await anon()('GET', `/public/courses/${a1.id}`)).json(),
    );
    expect(detail.classes.map((c) => c.id)).not.toContain(cancelled.id);
  });

  it('answers 404 for a retired course, a draft program, and an unknown id', async () => {
    for (const id of [hidden.id, unpublishedCourse.id, randomUUID().replace(/^(.{14})4/, '$17')]) {
      const res = await anon()('GET', `/public/courses/${id}`);
      expect(res.statusCode, id).toBe(404);
    }
    expect((await anon()('GET', '/public/courses/not-a-uuid')).statusCode).toBe(400);
  });

  it('lists upcoming classes soonest first, only for public courses', async () => {
    const draftClass = await makeClass(unpublishedCourse.id);
    const res = await anon()('GET', '/public/classes?limit=50');
    const { items } = publicClassListResponseSchema.parse(res.json());

    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.map((c) => c.id)).not.toContain(draftClass.id);
    const starts = items.map((c) => c.startDate);
    expect(starts).toEqual([...starts].sort());
    expect(items[0]?.courseName).toBeTruthy();

    const limited = publicClassListResponseSchema.parse(
      (await anon()('GET', '/public/classes?limit=1')).json(),
    );
    expect(limited.items).toHaveLength(1);
  });
});

describe('contact', () => {
  it('gives the institution and its active branches', async () => {
    const contact = publicContactSchema.parse((await anon()('GET', '/public/contact')).json());
    expect(contact).toMatchObject({ name: 'Lingua Institute', email: 'hello@lingua.test' });
    expect(contact.branches.map((b) => b.name)).toEqual(['Bole']);
  });
});

describe('pre-registration', () => {
  it('lands in the admissions queue and emails the applicant a reference', async () => {
    const body = form({
      givenName: 'Selam',
      fatherName: 'Tesfaye',
      email: 'selam@example.test',
      preferredShiftId: evening.id,
      guardianName: 'Tesfaye Alemu',
      guardianPhone: '0911223344',
      message: 'Evening please',
    });
    const res = await submit(body);
    expect(res.statusCode, res.body).toBe(201);
    const { reference } = preRegistrationResponseSchema.parse(res.json());
    expect(reference).toMatch(/^APP-/);

    const [application] = await queue('Tesfaye');
    expect(application).toMatchObject({
      reference,
      status: 'submitted',
      givenName: 'Selam',
      source: 'website',
      desiredCourseId: a1.id,
      preferredShiftId: evening.id,
      branchId: bole.id,
    });
    expect(application?.notes).toContain('Tesfaye Alemu, +251911223344');
    expect(application?.notes).toContain('Evening please');

    const email = await mailApp.mail.lastTo('selam@example.test');
    expect(email?.subject).toContain(reference ?? 'missing');
    expect(email?.text).toContain('English A1');
  });

  it('sends nothing when the applicant gave no email', async () => {
    const before = (await mailApp.mail.sent()).length;
    expect((await submit(form())).statusCode).toBe(201);
    expect((await mailApp.mail.sent()).length).toBe(before);
  });

  it('replays a retry with the same key: one application, same answer', async () => {
    const body = form({ fatherName: 'Retry' });
    const idem = randomUUID();
    const first = await submit(body, { idem });
    const second = await submit(body, { idem });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(await queue('Retry')).toHaveLength(1);
  });

  it('refuses a request without an Idempotency-Key, or a key that is not a UUID', async () => {
    expect(code(await submit(form(), { idem: null }))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(code(await submit(form(), { idem: 'not-a-uuid' }))).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  it('creates one application when the same person submits again with a new key', async () => {
    const body = form({ fatherName: 'Twice' });
    const first = preRegistrationResponseSchema.parse((await submit(body)).json());
    const again = preRegistrationResponseSchema.parse((await submit(body)).json());

    expect(first.reference).not.toBeNull();
    expect(again).toEqual({ received: true, reference: null });
    expect(await queue('Twice')).toHaveLength(1);
  });

  it('creates exactly one application when ten identical requests arrive at once', async () => {
    const body = form({ fatherName: 'Stampede' });
    const results = await Promise.all(Array.from({ length: 10 }, () => submit(body)));

    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const references = results.map((r) => preRegistrationResponseSchema.parse(r.json()).reference);
    expect(references.filter((r) => r !== null)).toHaveLength(1);
    expect(await queue('Stampede')).toHaveLength(1);
  });

  it('still accepts the same person for a different course', async () => {
    const body = form({ fatherName: 'Both' });
    expect((await submit(body)).statusCode).toBe(201);
    const other = preRegistrationResponseSchema.parse(
      (await submit({ ...body, desiredCourseId: a2.id })).json(),
    );
    expect(other.reference).not.toBeNull();
    expect(await queue('Both')).toHaveLength(2);
  });

  it('stores nothing when the hidden honeypot field is filled', async () => {
    const res = await submit(form({ fatherName: 'Botty', companyWebsite: 'http://spam.example' }));
    expect(res.statusCode).toBe(201);
    expect(preRegistrationResponseSchema.parse(res.json()).reference).toBeNull();
    expect(await queue('Botty')).toHaveLength(0);
  });

  it('rejects bad input with field errors', async () => {
    for (const bad of [
      form({ consent: false }),
      form({ phone: 'abc' }),
      form({ givenName: '' }),
      form({ email: 'not-an-email' }),
      form({ gender: 'other' }),
      { ...form(), branchId: undefined },
      { ...form(), desiredCourseId: undefined },
    ]) {
      const res = await submit(bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it('refuses courses that are not public, unknown branches and retired shifts', async () => {
    expect(code(await submit(form({ desiredCourseId: unpublishedCourse.id })))).toBe(
      'REFERENCE_NOT_FOUND',
    );
    expect(code(await submit(form({ desiredCourseId: hidden.id })))).toBe('REFERENCE_NOT_FOUND');
    expect(code(await submit(form({ branchId: closedBranch.id })))).toBe('REFERENCE_NOT_FOUND');
    expect(code(await submit(form({ branchId: randomUUID().replace(/^(.{14})4/, '$17') })))).toBe(
      'REFERENCE_NOT_FOUND',
    );
    await asAdmin('PATCH', `/shifts/${morning.id}`, { isActive: false }, ifMatch(1));
    expect(code(await submit(form({ preferredShiftId: morning.id })))).toBe('REFERENCE_NOT_FOUND');
  });

  it('is rate limited per visitor', async () => {
    const ip = '10.9.9.9';
    const statuses: number[] = [];
    for (let n = 0; n < 7; n++) statuses.push((await submit(form(), { ip })).statusCode);
    expect(statuses.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('records the submission in the audit log without personal details', async () => {
    const res = await asAdmin('GET', '/audit-log?action=application.submitted_online&limit=5');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toContain('application.submitted_online');
    expect(res.body).not.toContain('Kebede');
    expect(res.body).not.toContain('selam@example.test');
  });
});

describe('switching modules off', () => {
  it('turns pre-registration off without touching the catalog, then the whole site', async () => {
    const setModule = (name: string, enabled: boolean) =>
      asAdmin('PUT', `/modules/${name}`, { enabled });

    expect((await setModule('pre_registration', false)).statusCode).toBe(200);
    expect((await submit(form())).statusCode).toBe(404);
    expect((await anon()('GET', '/public/catalog')).statusCode).toBe(200);

    expect((await setModule('website', false)).statusCode).toBe(200);
    expect((await anon()('GET', '/public/catalog')).statusCode).toBe(404);
    expect((await anon()('GET', '/public/contact')).statusCode).toBe(404);
    expect((await anon()('GET', '/institution/public')).statusCode).toBe(200);

    expect((await setModule('website', true)).statusCode).toBe(200);
    expect((await setModule('pre_registration', true)).statusCode).toBe(200);
    expect((await submit(form())).statusCode).toBe(201);
  });
});
