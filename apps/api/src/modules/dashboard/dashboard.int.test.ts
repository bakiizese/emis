import { randomUUID } from 'node:crypto';

import {
  applicationSchema,
  approvalSchema,
  branchSchema,
  cohortSchema,
  courseSchema,
  dashboardSchema,
  departmentSchema,
  enrollResponseSchema,
  feeStructureSchema,
  invoiceSchema,
  paymentPlanSchema,
  paymentSchema,
  programSchema,
  roomSchema,
  shiftSchema,
  studentSchema,
} from '@emis/contracts';
import { roles, userRoleAssignments } from '@emis/db';
import { createIsolatedDatabase, type TestDatabaseUrls } from '@emis/db/testing';
import type { Scope } from '@emis/permissions';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { DbAdapter } from '../../database/database.module.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { callAs, createStaff, type StaffFixture } from '../../testing/staff-fixtures.js';

// Own database: every number here counts only what this file records.
let urls: TestDatabaseUrls;
let app: NestFastifyApplication;
let asAdmin: ReturnType<typeof callAs>;
let asAdmin2: ReturnType<typeof callAs>;

let bole: { id: string };
let piassa: { id: string };

const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const key = () => ({ 'idempotency-key': randomUUID() });
const todayAddis = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());
const plusDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

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

const dashboardOf = async (who: ReturnType<typeof callAs>) => {
  const res = await who('GET', '/dashboard');
  expect(res.statusCode, res.body).toBe(200);
  return dashboardSchema.parse(res.json());
};

let counter = 0;
const student = async (branchId: string) =>
  studentSchema.parse(
    (
      await asAdmin(
        'POST',
        '/students',
        {
          givenName: `Learner${++counter}`,
          fatherName: `Family${String(counter).padStart(3, '0')}`,
          gender: 'female',
          phone: `09${String(80_000_000 + counter)}`,
          branchId,
          confirmNotDuplicate: true,
        },
        key(),
      )
    ).json(),
  );

async function openClass(
  name: string,
  courseId: string,
  roomId: string,
  shiftId: string,
  maxSize: number,
  offset: number,
) {
  const start = plusDays(todayAddis(), offset);
  const made = await post(
    asAdmin,
    '/cohorts',
    { name, courseId, shiftId, roomId, maxSize, startDate: start, endDate: plusDays(start, 4) },
    cohortSchema,
  );
  const res = await asAdmin(
    'POST',
    `/cohorts/${made.id}/status`,
    { status: 'open' },
    ifMatch(made.version),
  );
  expect(res.statusCode, res.body).toBe(200);
  return cohortSchema.parse(res.json());
}

async function enroll(studentId: string, cohortId: string) {
  const res = await asAdmin('POST', '/enrollments', { studentId, cohortId }, key());
  expect(res.statusCode, res.body).toBe(201);
  return enrollResponseSchema.parse(res.json()).enrollment;
}

async function billAndPay(
  studentId: string,
  cohortId: string,
  amount?: number,
  method = 'cash',
  reference?: string,
) {
  const enrollment = await enroll(studentId, cohortId);
  const invoice = invoiceSchema.parse(
    (await asAdmin('POST', '/invoices', { enrollmentId: enrollment.id }, key())).json(),
  );
  if (amount === undefined) return null;
  return post(
    asAdmin,
    '/payments',
    { invoiceId: invoice.id, amount, method, reference },
    paymentSchema,
  );
}

let asBoleDesk: ReturnType<typeof callAs>;
let asPiassaDesk: ReturnType<typeof callAs>;
let asCoordinator: ReturnType<typeof callAs>;
let asInstructor: ReturnType<typeof callAs>;
let asNoRole: ReturnType<typeof callAs>;

beforeAll(async () => {
  urls = await createIsolatedDatabase(inject('database'), 'emis_dashboard_test');
  app = await createTestApp({ env: { DATABASE_URL: urls.appUrl, RATE_LIMIT_MAX: '100000' } });
  asAdmin = callAs(
    app,
    await createStaff(app, { email: 'dash-admin@lingua.test', roleKey: 'admin' }),
  );
  asAdmin2 = callAs(
    app,
    await createStaff(app, { email: 'dash-admin2@lingua.test', roleKey: 'admin' }),
  );
  asCoordinator = callAs(
    app,
    await createStaff(app, { email: 'dash-coord@lingua.test', roleKey: 'coordinator' }),
  );
  asInstructor = callAs(
    app,
    await createStaff(app, { email: 'dash-teacher@lingua.test', roleKey: 'instructor' }),
  );
  asNoRole = callAs(app, await createStaff(app, { email: 'dash-nobody@lingua.test' }));

  await asAdmin('PATCH', '/institution', { name: 'Lingua', primaryColor: '#0f766e' }, ifMatch(1));
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
  const boleDesk = await createStaff(app, { email: 'dash-bole@lingua.test' });
  await grantRole(boleDesk, 'secretary', { type: 'branch', id: bole.id });
  asBoleDesk = callAs(app, boleDesk);
  const piassaDesk = await createStaff(app, { email: 'dash-piassa@lingua.test' });
  await grantRole(piassaDesk, 'secretary', { type: 'branch', id: piassa.id });
  asPiassaDesk = callAs(app, piassaDesk);

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
  const a1 = await post(
    asAdmin,
    '/courses',
    { programId: english.id, code: 'A1', name: 'English A1' },
    courseSchema,
  );
  const py1 = await post(
    asAdmin,
    '/courses',
    { programId: python.id, code: 'PY1', name: 'Python 1' },
    courseSchema,
  );
  const evening = await post(
    asAdmin,
    '/shifts',
    { code: 'EVE', name: 'Evening', daysOfWeek: [1, 3, 5], startTime: '17:00', endTime: '19:00' },
    shiftSchema,
  );
  const morning = await post(
    asAdmin,
    '/shifts',
    { code: 'MOR', name: 'Morning', daysOfWeek: [1, 3, 5], startTime: '08:00', endTime: '10:00' },
    shiftSchema,
  );
  const roomBole = await post(
    asAdmin,
    '/rooms',
    { branchId: bole.id, code: 'R1', name: 'R1', type: 'classroom', capacity: 30 },
    roomSchema,
  );
  const roomBole2 = await post(
    asAdmin,
    '/rooms',
    { branchId: bole.id, code: 'R2', name: 'R2', type: 'classroom', capacity: 30 },
    roomSchema,
  );
  const roomPiassa = await post(
    asAdmin,
    '/rooms',
    { branchId: piassa.id, code: 'R3', name: 'R3', type: 'classroom', capacity: 30 },
    roomSchema,
  );
  for (const [courseId, amount] of [
    [a1.id, 100_000],
    [py1.id, 50_000],
  ] as const) {
    await post(
      asAdmin,
      '/fee-structures',
      {
        name: 'Fee',
        courseId,
        effectiveFrom: '2026-01-01',
        components: [{ name: 'Tuition', amount }],
      },
      feeStructureSchema,
    );
  }
  await post(
    asAdmin,
    '/payment-plans',
    {
      name: 'Three payments',
      isDefault: true,
      installments: [
        { shareBp: 5000, dueOffsetDays: 0 },
        { shareBp: 3000, dueOffsetDays: 30 },
        { shareBp: 2000, dueOffsetDays: 60 },
      ],
    },
    paymentPlanSchema,
  );

  const engBole = await openClass('English A1 Bole', a1.id, roomBole.id, evening.id, 10, 5);
  const pyBole = await openClass('Python Bole', py1.id, roomBole2.id, morning.id, 5, 10);
  const engPiassa = await openClass('English A1 Piassa', a1.id, roomPiassa.id, evening.id, 2, 40);

  // Bole: three in English (one has paid), two in Python (unpaid). Piassa: two enrolled (one paid) and one waiting.
  await billAndPay((await student(bole.id)).id, engBole.id, 50_000);
  await billAndPay((await student(bole.id)).id, engBole.id);
  await enroll((await student(bole.id)).id, engBole.id);
  await billAndPay((await student(bole.id)).id, pyBole.id);
  await enroll((await student(bole.id)).id, pyBole.id);
  const s3 = await billAndPay(
    (await student(piassa.id)).id,
    engPiassa.id,
    30_000,
    'cheque',
    'CHQ-1',
  );
  await enroll((await student(piassa.id)).id, engPiassa.id);
  const waiting = await asAdmin(
    'POST',
    '/enrollments',
    { studentId: (await student(piassa.id)).id, cohortId: engPiassa.id },
    key(),
  );
  expect(enrollResponseSchema.parse(waiting.json()).enrollment.status).toBe('waitlisted');

  const walkIn = (branchId: string) =>
    post(
      asAdmin,
      '/applications',
      {
        givenName: 'Walker',
        fatherName: `Applicant${++counter}`,
        gender: 'male',
        phone: `09${String(85_000_000 + counter)}`,
        branchId,
      },
      applicationSchema,
    );
  const contacted = await walkIn(bole.id);
  await walkIn(bole.id);
  await walkIn(piassa.id);
  expect(
    (
      await asAdmin(
        'POST',
        `/applications/${contacted.id}/transition`,
        { to: 'contacted' },
        ifMatch(contacted.version),
      )
    ).statusCode,
  ).toBe(200);

  // One void request waiting for someone other than its requester.
  approvalSchema.parse(
    (
      await asAdmin2('POST', `/payments/${s3!.id}/void-requests`, {
        reason: 'Wrong amount entered',
      })
    ).json(),
  );
});

afterAll(async () => {
  await app?.close();
});

describe('for an admin', () => {
  it('counts the whole institution', async () => {
    const d = await dashboardOf(asAdmin);
    expect(d.today).toBe(todayAddis());
    expect(d.currency).toBe('ETB');
    expect(d.admissions).toEqual({ newCount: 2, openCount: 3, last7Days: 3 });
    expect(d.students).toEqual({ active: 8 });
    expect(d.classes).toMatchObject({ open: 3, running: 0, waitlisted: 1 });
  });

  it('shows seats filled against seats available for each shift', async () => {
    const { classes } = await dashboardOf(asAdmin);
    expect(classes?.occupancy.map((o) => [o.shiftName, o.capacity, o.enrolled])).toEqual([
      ['Evening', 12, 5],
      ['Morning', 5, 2],
    ]);
  });

  it('lists classes starting within two weeks, soonest first', async () => {
    const { classes } = await dashboardOf(asAdmin);
    expect(classes?.startingSoon.map((c) => c.name)).toEqual(['English A1 Bole', 'Python Bole']);
    expect(classes?.startingSoon[0]).toMatchObject({
      startDate: plusDays(todayAddis(), 5),
      capacity: 10,
      enrolled: 3,
      seatsLeft: 7,
    });
  });

  it('counts active enrollments by department', async () => {
    const { enrollmentsByDepartment } = await dashboardOf(asAdmin);
    expect(enrollmentsByDepartment?.map((r) => [r.name, r.active])).toEqual([
      ['Language', 5],
      ['Computer', 2],
    ]);
  });

  it('shows the money: collected, owed, overdue', async () => {
    const d = await dashboardOf(asAdmin);
    expect(d.finance).toEqual({
      collectedThisMonth: 80_000,
      collectedLastMonth: 0,
      outstanding: 270_000,
      overdue: 0,
      overdueCount: 0,
    });
    expect(d.desk).toEqual({
      collectedToday: 80_000,
      paymentsToday: 2,
      dueToday: 3,
      overdueCount: 0,
    });
  });

  it('counts approvals waiting for someone else to decide, never the caller’s own', async () => {
    expect((await dashboardOf(asAdmin)).approvals).toEqual({ pending: 1 });
    expect((await dashboardOf(asAdmin2)).approvals).toEqual({ pending: 0 });
  });

  it('is never cached', async () => {
    expect((await asAdmin('GET', '/dashboard')).headers['cache-control']).toBe('private, no-store');
  });
});

describe('for a front desk', () => {
  it('covers only their own branch', async () => {
    const d = await dashboardOf(asBoleDesk);
    expect(d.admissions).toEqual({ newCount: 1, openCount: 2, last7Days: 2 });
    expect(d.students).toEqual({ active: 5 });
    expect(d.classes).toMatchObject({ open: 2, waitlisted: 0 });
    expect(d.classes?.occupancy.map((o) => [o.shiftName, o.capacity, o.enrolled])).toEqual([
      ['Evening', 10, 3],
      ['Morning', 5, 2],
    ]);
    expect(d.classes?.startingSoon.map((c) => c.name)).toEqual(['English A1 Bole', 'Python Bole']);
    expect(d.enrollmentsByDepartment?.map((r) => [r.name, r.active])).toEqual([
      ['Language', 3],
      ['Computer', 2],
    ]);
    expect(d.desk).toEqual({
      collectedToday: 50_000,
      paymentsToday: 1,
      dueToday: 2,
      overdueCount: 0,
    });
  });

  it('never shows another branch, or revenue and approvals they may not see', async () => {
    const d = await dashboardOf(asPiassaDesk);
    expect(d.admissions).toEqual({ newCount: 1, openCount: 1, last7Days: 1 });
    expect(d.students).toEqual({ active: 3 });
    expect(d.classes).toMatchObject({ open: 1, waitlisted: 1 });
    expect(d.classes?.startingSoon).toEqual([]);
    expect(d.desk).toEqual({
      collectedToday: 30_000,
      paymentsToday: 1,
      dueToday: 1,
      overdueCount: 0,
    });
    expect(d.finance).toBeUndefined();
    expect(d.approvals).toBeUndefined();
  });
});

describe('for other roles', () => {
  it('gives a coordinator the academic side and no money', async () => {
    const d = await dashboardOf(asCoordinator);
    expect(d.admissions?.openCount).toBe(3);
    expect(d.classes?.open).toBe(3);
    expect(d.students?.active).toBe(8);
    expect(d.desk).toBeUndefined();
    expect(d.finance).toBeUndefined();
    expect(d.approvals).toBeUndefined();
  });

  it('gives an instructor and someone with no role an empty page, not an error', async () => {
    for (const who of [asInstructor, asNoRole]) {
      const d = await dashboardOf(who);
      expect(Object.keys(d).sort()).toEqual(['currency', 'today']);
    }
  });

  it('needs a signed-in user', async () => {
    expect((await callAs(app, null)('GET', '/dashboard')).statusCode).toBe(401);
  });
});
