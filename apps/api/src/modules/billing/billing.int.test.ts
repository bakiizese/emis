import { randomUUID } from 'node:crypto';

import {
  approvalListResponseSchema,
  approvalSchema,
  auditListResponseSchema,
  branchSchema,
  cohortSchema,
  courseSchema,
  departmentSchema,
  enrollResponseSchema,
  feeStructureSchema,
  invoiceListResponseSchema,
  invoiceSchema,
  paymentPlanListResponseSchema,
  paymentPlanSchema,
  paymentSchema,
  problemDetailsSchema,
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
import type { LightMyRequestResponse } from 'fastify';
import { ClsService } from 'nestjs-cls';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { DbAdapter } from '../../database/database.module.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { callAs, createStaff, type StaffFixture } from '../../testing/staff-fixtures.js';

// Own database: receipt and invoice numbers are counted from 1, and every check below is about totals.
let urls: TestDatabaseUrls;
let app: NestFastifyApplication;
let asAdmin: ReturnType<typeof callAs>;
let asSecondAdmin: ReturnType<typeof callAs>;
let asBoleDesk: ReturnType<typeof callAs>;
let asCoordinator: ReturnType<typeof callAs>;
let adminFixture: StaffFixture;

let bole: { id: string };
let piassa: { id: string };
let course: { id: string }; // A1: has fees
let feeless: { id: string }; // no fee structure
let dated: { id: string }; // effective-date tests
let bigRoom: { id: string };
let shift: { id: string };
let cohort: { id: string };
let piassaCohort: { id: string };
let plan: { id: string; version: number };

const code = (res: LightMyRequestResponse) => problemDetailsSchema.parse(res.json()).code;
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const key = () => ({ 'idempotency-key': randomUUID() });
const TOTAL = 450_000; // ETB 4,500.00

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

let weekCounter = 0;
function nextWeek() {
  const start = new Date(Date.UTC(2027, 0, 4 + 7 * weekCounter++));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 4);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

const openCohort = async (courseId: string, roomId: string, maxSize = 30) => {
  const made = await post(
    asAdmin,
    '/cohorts',
    {
      name: `Class ${randomUUID().slice(0, 6)}`,
      courseId,
      shiftId: shift.id,
      roomId,
      maxSize,
      ...nextWeek(),
    },
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
};

let studentCounter = 0;
const nextStudent = async (extra: Record<string, unknown> = {}) => {
  const n = ++studentCounter;
  const res = await asBoleDesk(
    'POST',
    '/students',
    {
      givenName: `Payer${n}`,
      fatherName: `Family${String(n).padStart(3, '0')}`,
      gender: 'male',
      phone: `09${String(30_000_000 + n)}`,
      branchId: bole.id,
      confirmNotDuplicate: true,
      ...extra,
    },
    key(),
  );
  expect(res.statusCode, res.body).toBe(201);
  return studentSchema.parse(res.json());
};

const enrollStudent = async (cohortId: string, extra: Record<string, unknown> = {}) => {
  const student = await nextStudent(extra);
  const res = await asAdmin('POST', '/enrollments', { studentId: student.id, cohortId }, key());
  expect(res.statusCode, res.body).toBe(201);
  return { student, enrollment: enrollResponseSchema.parse(res.json()).enrollment };
};

const createInvoice = async (enrollmentId: string, who = asBoleDesk) => {
  const res = await who('POST', '/invoices', { enrollmentId }, key());
  expect(res.statusCode, res.body).toBe(201);
  return invoiceSchema.parse(res.json());
};

/** A fresh enrolled student with an invoice for the standard 4,500.00 course. */
const freshInvoice = async () => {
  const { student, enrollment } = await enrollStudent(cohort.id);
  return { student, enrollment, invoice: await createInvoice(enrollment.id) };
};

const pay = (
  invoiceId: string,
  amount: number,
  extra: Record<string, unknown> = {},
  who = asBoleDesk,
  headers = key(),
) => who('POST', '/payments', { invoiceId, amount, method: 'cash', ...extra }, headers);

const payOk = async (invoiceId: string, amount: number, extra: Record<string, unknown> = {}) => {
  const res = await pay(invoiceId, amount, extra);
  expect(res.statusCode, res.body).toBe(201);
  return paymentSchema.parse(res.json());
};

const invoiceNow = async (id: string) =>
  invoiceSchema.parse((await asAdmin('GET', `/invoices/${id}`)).json());

const withDb = async <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> => {
  const client = new pg.Client({ connectionString: urls.appUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
};

const todayAddis = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

beforeAll(async () => {
  urls = await createIsolatedDatabase(inject('database'), 'emis_billing_test');
  app = await createTestApp({ env: { DATABASE_URL: urls.appUrl, RATE_LIMIT_MAX: '100000' } });
  adminFixture = await createStaff(app, {
    email: 'billing-admin@lingua.test',
    roleKey: 'admin',
    displayName: 'First Admin',
  });
  asAdmin = callAs(app, adminFixture);
  asSecondAdmin = callAs(
    app,
    await createStaff(app, {
      email: 'billing-admin2@lingua.test',
      roleKey: 'admin',
      displayName: 'Second Admin',
    }),
  );

  const language = await post(
    asAdmin,
    '/departments',
    { code: 'LANG', name: 'Language' },
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
  const mkCourse = (courseCode: string) =>
    post(
      asAdmin,
      '/courses',
      { programId: english.id, code: courseCode, name: `English ${courseCode}` },
      courseSchema,
    );
  course = await mkCourse('A1');
  feeless = await mkCourse('A2');
  dated = await mkCourse('A3');

  shift = await post(
    asAdmin,
    '/shifts',
    { code: 'EVE', name: 'Evening', daysOfWeek: [1, 3, 5], startTime: '17:00', endTime: '19:00' },
    shiftSchema,
  );
  bigRoom = await post(
    asAdmin,
    '/rooms',
    { branchId: bole.id, code: 'R1', name: 'R1', type: 'classroom', capacity: 30 },
    roomSchema,
  );
  const piassaRoom = await post(
    asAdmin,
    '/rooms',
    { branchId: piassa.id, code: 'R2', name: 'R2', type: 'classroom', capacity: 30 },
    roomSchema,
  );

  for (const value of ['regular', 'scholarship']) {
    await post(
      asAdmin,
      '/descriptors',
      { namespace: 'student_category', code: value, label: value },
      { parse: (v: unknown) => v },
    );
  }
  for (const value of ['sibling', 'promotion']) {
    await post(
      asAdmin,
      '/descriptors',
      { namespace: 'discount_reason', code: value, label: value },
      { parse: (v: unknown) => v },
    );
  }

  const desk = await createStaff(app, { email: 'billing-desk@lingua.test' });
  await grantRole(desk, 'secretary', { type: 'branch', id: bole.id });
  asBoleDesk = callAs(app, desk);
  const coordinator = await createStaff(app, { email: 'billing-coord@lingua.test' });
  await grantRole(coordinator, 'coordinator', { type: 'department', id: language.id });
  asCoordinator = callAs(app, coordinator);

  cohort = await openCohort(course.id, bigRoom.id);
  piassaCohort = await openCohort(course.id, piassaRoom.id);
});
afterAll(() => app.close());

describe('fees and payment plans', () => {
  it('prices a course from the sum of its components', async () => {
    const structure = await post(
      asAdmin,
      '/fee-structures',
      {
        name: 'A1 standard',
        courseId: course.id,
        effectiveFrom: '2026-01-01',
        components: [
          { name: 'Tuition', amount: 400_000 },
          { name: 'Registration', amount: 50_000 },
        ],
      },
      feeStructureSchema,
    );
    expect(structure).toMatchObject({
      total: TOTAL,
      currency: 'ETB',
      categoryCode: null,
      isActive: true,
    });

    const dup = await asAdmin('POST', '/fee-structures', {
      name: 'Again',
      courseId: course.id,
      effectiveFrom: '2026-01-01',
      components: [{ name: 'Tuition', amount: 1000 }],
    });
    expect(dup.statusCode).toBe(409);
    expect(code(dup)).toBe('FEE_STRUCTURE_EXISTS');

    const badCategory = await asAdmin('POST', '/fee-structures', {
      name: 'VIP',
      courseId: course.id,
      categoryCode: 'vip',
      effectiveFrom: '2026-01-01',
      components: [{ name: 'Tuition', amount: 1000 }],
    });
    expect(code(badCategory)).toBe('INVALID_LIST_VALUE');
    const cents = await asAdmin('POST', '/fee-structures', {
      name: 'Fractional',
      courseId: dated.id,
      effectiveFrom: '2026-01-01',
      components: [{ name: 'Tuition', amount: 100.5 }],
    });
    expect(cents.statusCode).toBe(400);
  });

  it('is only for people with fee rights, and can be read by the front desk', async () => {
    expect((await asBoleDesk('GET', '/fee-structures')).statusCode).toBe(200);
    expect(
      (
        await asBoleDesk('POST', '/fee-structures', {
          name: 'Nope',
          courseId: course.id,
          effectiveFrom: '2026-01-01',
          components: [{ name: 'X', amount: 1000 }],
        })
      ).statusCode,
    ).toBe(403);
    expect((await asCoordinator('GET', '/payment-plans')).statusCode).toBe(200);
    expect((await asCoordinator('GET', '/invoices')).statusCode).toBe(403);
  });

  it('creates plans that add up, and keeps a single default', async () => {
    const bad = await asAdmin('POST', '/payment-plans', {
      name: 'Broken',
      installments: [
        { shareBp: 5000, dueOffsetDays: 0 },
        { shareBp: 4000, dueOffsetDays: 30 },
      ],
    });
    expect(bad.statusCode).toBe(400);

    plan = await post(
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
    const second = await post(
      asAdmin,
      '/payment-plans',
      {
        name: 'Pay in full',
        isDefault: true,
        installments: [{ shareBp: 10000, dueOffsetDays: 0 }],
      },
      paymentPlanSchema,
    );
    const plans = paymentPlanListResponseSchema.parse(
      (await asAdmin('GET', '/payment-plans')).json(),
    );
    expect(plans.items.filter((p) => p.isDefault).map((p) => p.id)).toEqual([second.id]);
    // Put the three-payment plan back as the default for the rest of the tests.
    const back = await asAdmin(
      'PATCH',
      `/payment-plans/${plan.id}`,
      { isDefault: true },
      ifMatch(plan.version),
    );
    expect(paymentPlanSchema.parse(back.json()).isDefault).toBe(true);
  });

  it('picks the category price over the general one, and the latest date that has started', async () => {
    await post(
      asAdmin,
      '/fee-structures',
      {
        name: 'A1 scholarship',
        courseId: course.id,
        categoryCode: 'scholarship',
        effectiveFrom: '2026-01-01',
        components: [{ name: 'Tuition', amount: 300_000 }],
      },
      feeStructureSchema,
    );
    const scholar = await enrollStudent(cohort.id, { categoryCode: 'scholarship' });
    expect((await createInvoice(scholar.enrollment.id)).total).toBe(300_000);

    for (const [effectiveFrom, amount] of [
      ['2026-01-01', 100_000],
      ['2026-06-01', 120_000],
      ['2099-01-01', 999_999],
    ] as const) {
      await post(
        asAdmin,
        '/fee-structures',
        {
          name: `A3 from ${effectiveFrom}`,
          courseId: dated.id,
          effectiveFrom,
          components: [{ name: 'Tuition', amount }],
        },
        feeStructureSchema,
      );
    }
    const datedCohort = await openCohort(dated.id, bigRoom.id);
    const student = await enrollStudent(datedCohort.id);
    expect((await createInvoice(student.enrollment.id)).total).toBe(120_000);
  });
});

describe('invoices', () => {
  it('bills an enrollment: numbered, split by the plan, due dates spaced by its offsets', async () => {
    const { student, invoice } = await freshInvoice();
    expect(invoice).toMatchObject({
      status: 'issued',
      currency: 'ETB',
      subtotal: TOTAL,
      discountTotal: 0,
      total: TOTAL,
      paidTotal: 0,
      balance: TOTAL,
      studentNumber: student.studentNumber,
      branchId: bole.id,
    });
    expect(invoice.number).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(invoice.lines).toEqual([
      { description: 'Tuition', amount: 400_000 },
      { description: 'Registration', amount: 50_000 },
    ]);
    expect(invoice.installments.map((i) => i.amount)).toEqual([225_000, 135_000, 90_000]);
    expect(invoice.installments.map((i) => i.status)).toEqual(['due', 'due', 'due']);
    const [first, second, third] = invoice.installments;
    expect(first?.dueDate).toBe(todayAddis());
    expect(daysBetween(first!.dueDate, second!.dueDate)).toBe(30);
    expect(daysBetween(second!.dueDate, third!.dueDate)).toBe(30);
  });

  it('bills an enrollment only once, even when asked many times at once', async () => {
    const { enrollment } = await enrollStudent(cohort.id);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        asBoleDesk('POST', '/invoices', { enrollmentId: enrollment.id }, key()),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409, 409]);
    expect(code(results.find((r) => r.statusCode === 409)!)).toBe('ALREADY_INVOICED');
    // The failed attempts gave their invoice numbers back: the next one follows on without a gap.
    const seq = (n: string) => Number(n.split('-')[2]);
    const winner = invoiceSchema.parse(results.find((r) => r.statusCode === 201)!.json());
    const next = await freshInvoice();
    expect(seq(next.invoice.number)).toBe(seq(winner.number) + 1);
  });

  it('replays a retry with the same key', async () => {
    const { enrollment } = await enrollStudent(cohort.id);
    const headers = key();
    const first = await asBoleDesk('POST', '/invoices', { enrollmentId: enrollment.id }, headers);
    const second = await asBoleDesk('POST', '/invoices', { enrollmentId: enrollment.id }, headers);
    expect(second.json()).toEqual(first.json());
    expect(
      (await asBoleDesk('POST', '/invoices', { enrollmentId: enrollment.id })).statusCode,
    ).toBe(400);
  });

  it('refuses when there is no fee, no seat yet, or another branch', async () => {
    const noFee = await openCohort(feeless.id, bigRoom.id);
    const a = await enrollStudent(noFee.id);
    const res = await asBoleDesk('POST', '/invoices', { enrollmentId: a.enrollment.id }, key());
    expect(res.statusCode).toBe(422);
    expect(code(res)).toBe('NO_FEE_STRUCTURE');

    const tight = await openCohort(course.id, bigRoom.id, 1);
    await enrollStudent(tight.id);
    const waiting = await asAdmin(
      'POST',
      '/enrollments',
      { studentId: (await nextStudent()).id, cohortId: tight.id },
      key(),
    );
    const waitlisted = enrollResponseSchema.parse(waiting.json());
    expect(waitlisted.outcome).toBe('waitlisted');
    const notYet = await asBoleDesk(
      'POST',
      '/invoices',
      { enrollmentId: waitlisted.enrollment.id },
      key(),
    );
    expect(code(notYet)).toBe('ENROLLMENT_NOT_BILLABLE');

    const elsewhere = await enrollStudent(piassaCohort.id);
    expect(
      (await asBoleDesk('POST', '/invoices', { enrollmentId: elsewhere.enrollment.id }, key()))
        .statusCode,
    ).toBe(403);
    const adminInvoice = await createInvoice(elsewhere.enrollment.id, asAdmin);
    expect((await asBoleDesk('GET', `/invoices/${adminInvoice.id}`)).statusCode).toBe(403);
  });

  it('lists invoices by student and number, only for the caller’s branch', async () => {
    const { student, invoice } = await freshInvoice();
    const byStudent = invoiceListResponseSchema.parse(
      (await asBoleDesk('GET', `/invoices?studentId=${student.id}`)).json(),
    );
    expect(byStudent.items.map((i) => i.id)).toEqual([invoice.id]);
    const byNumber = invoiceListResponseSchema.parse(
      (await asBoleDesk('GET', `/invoices?q=${invoice.number}`)).json(),
    );
    expect(byNumber.items.map((i) => i.id)).toEqual([invoice.id]);
    const unpaid = invoiceListResponseSchema.parse(
      (await asBoleDesk('GET', '/invoices?stage=unpaid&limit=100')).json(),
    );
    expect(unpaid.items.every((i) => i.branchId === bole.id)).toBe(true);
  });
});

describe('recording payments', () => {
  it('pays the oldest instalment first and issues a numbered receipt', async () => {
    const { invoice } = await freshInvoice();
    const first = await payOk(invoice.id, 100_000);
    expect(first).toMatchObject({
      amount: 100_000,
      method: 'cash',
      providerKey: 'manual',
      status: 'posted',
    });
    expect(first.receiptNumber).toMatch(/^RCP-BOLE-\d{4}-\d{6}$/);
    expect(first.allocations.map((a) => [a.sequence, a.amount])).toEqual([[1, 100_000]]);

    const second = await payOk(invoice.id, 150_000);
    // 125,000 finishes instalment 1, the other 25,000 starts instalment 2.
    expect(second.allocations.map((a) => [a.sequence, a.amount])).toEqual([
      [1, 125_000],
      [2, 25_000],
    ]);
    const seq = (n: string) => Number(n.split('-')[3]);
    expect(seq(second.receiptNumber)).toBe(seq(first.receiptNumber) + 1);

    const now = await invoiceNow(invoice.id);
    expect(now).toMatchObject({ status: 'partially_paid', paidTotal: 250_000, balance: 200_000 });
    expect(now.installments.map((i) => [i.paidAmount, i.status])).toEqual([
      [225_000, 'paid'],
      [25_000, 'partial'],
      [0, 'due'],
    ]);
  });

  it('needs a reference for bank transfers and cheques, and whole santim', async () => {
    const { invoice } = await freshInvoice();
    expect((await pay(invoice.id, 1000, { method: 'bank_transfer' })).statusCode).toBe(400);
    expect((await pay(invoice.id, 1000, { method: 'cheque', reference: '' })).statusCode).toBe(400);
    const ok = await payOk(invoice.id, 1000, { method: 'bank_transfer', reference: 'CBE-99812' });
    expect(ok.reference).toBe('CBE-99812');
    for (const amount of [0, -100, 10.5])
      expect((await pay(invoice.id, amount)).statusCode).toBe(400);
  });

  it('refuses an overpayment without issuing a receipt or using up a number', async () => {
    const { invoice } = await freshInvoice();
    const before = await payOk(invoice.id, 1000);
    const res = await pay(invoice.id, TOTAL);
    expect(res.statusCode).toBe(422);
    expect(code(res)).toBe('OVERPAYMENT');
    expect((await invoiceNow(invoice.id)).paidTotal).toBe(1000);
    const after = await payOk(invoice.id, 1000);
    const seq = (n: string) => Number(n.split('-')[3]);
    expect(seq(after.receiptNumber)).toBe(seq(before.receiptNumber) + 1);
  });

  it('settles the invoice on the last payment and then takes no more', async () => {
    const { invoice } = await freshInvoice();
    await payOk(invoice.id, TOTAL - 5000);
    await payOk(invoice.id, 5000);
    const done = await invoiceNow(invoice.id);
    expect(done).toMatchObject({ status: 'paid', balance: 0, paidTotal: TOTAL });
    expect(done.installments.every((i) => i.status === 'paid')).toBe(true);
    const more = await pay(invoice.id, 100);
    expect(more.statusCode).toBe(409);
    expect(code(more)).toBe('INVOICE_CLOSED');
  });

  it('replays a retried payment: one payment, one receipt', async () => {
    const { invoice } = await freshInvoice();
    const headers = key();
    const first = await pay(invoice.id, 20_000, {}, asBoleDesk, headers);
    const second = await pay(invoice.id, 20_000, {}, asBoleDesk, headers);
    expect(second.json()).toEqual(first.json());
    expect((await invoiceNow(invoice.id)).paidTotal).toBe(20_000);
    expect((await pay(invoice.id, 1, {}, asBoleDesk, {} as never)).statusCode).toBe(400);
  });

  it('keeps receipts gapless and totals exact when many payments race for one invoice', async () => {
    const { invoice } = await freshInvoice();
    // 20 clerks each take 300.00 against an invoice that only owes 4,500.00: 15 fit.
    const results = await Promise.all(Array.from({ length: 20 }, () => pay(invoice.id, 30_000)));
    const succeeded = results.filter((r) => r.statusCode === 201);
    expect(succeeded).toHaveLength(15);
    expect(
      results
        .filter((r) => r.statusCode !== 201)
        .every((r) => ['OVERPAYMENT', 'INVOICE_CLOSED'].includes(code(r))),
    ).toBe(true);

    const done = await invoiceNow(invoice.id);
    expect(done).toMatchObject({ status: 'paid', paidTotal: TOTAL, balance: 0 });
    const numbers = succeeded
      .map((r) => Number(paymentSchema.parse(r.json()).receiptNumber.split('-')[3]))
      .sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(15);
    expect(numbers[numbers.length - 1]! - numbers[0]!).toBe(14);

    // Across the whole database: every receipt number from 1 up is used exactly once.
    const all = await withDb((c) =>
      c.query<{ n: number }>(
        "SELECT split_part(number, '-', 4)::int AS n FROM receipts ORDER BY n",
      ),
    );
    expect(all.rows.map((r) => r.n)).toEqual(
      Array.from({ length: all.rows.length }, (_, i) => i + 1),
    );
  });

  it('is limited to the caller’s branch and to people who take payments', async () => {
    const elsewhere = await enrollStudent(piassaCohort.id);
    const invoice = await createInvoice(elsewhere.enrollment.id, asAdmin);
    expect((await pay(invoice.id, 1000)).statusCode).toBe(403);
    expect((await pay(invoice.id, 1000, {}, asCoordinator)).statusCode).toBe(403);
    expect((await pay(invoice.id, 1000, {}, asAdmin)).statusCode).toBe(201);
  });

  it('keeps the amount and receipt number in the audit log, not the payer’s name', async () => {
    const { student, invoice } = await freshInvoice();
    const payment = await payOk(invoice.id, 12_345);
    const audit = auditListResponseSchema.parse(
      (await asAdmin('GET', `/audit-log?action=payment.recorded&entityId=${payment.id}`)).json(),
    );
    const text = JSON.stringify(audit.items[0]?.changes);
    expect(text).toContain(payment.receiptNumber);
    expect(text).toContain('12345');
    expect(text).not.toContain(student.givenName);
    expect(text).not.toContain(student.phone);
  });
});

describe('discounts need a second person', () => {
  const requestDiscount = (invoiceId: string, body: object, who = asBoleDesk) =>
    who('POST', `/invoices/${invoiceId}/discount-requests`, { reasonCode: 'sibling', ...body });
  const decide = (id: string, decision: 'approve' | 'reject', who = asAdmin) =>
    who('POST', `/approvals/${id}/decision`, { decision });

  it('leaves the invoice alone until someone else approves, then reduces the latest instalments', async () => {
    const { invoice } = await freshInvoice();
    const req = await requestDiscount(invoice.id, { kind: 'percent', value: 1000 });
    expect(req.statusCode, req.body).toBe(201);
    const approval = approvalSchema.parse(req.json());
    expect(approval).toMatchObject({ type: 'discount', status: 'pending', subjectId: invoice.id });
    expect(approval.summary).toContain(invoice.number);
    expect(approval.summary).toContain('10% off');
    expect((await invoiceNow(invoice.id)).total).toBe(TOTAL);

    // The requester can't decide (no permission), and neither can a Coordinator.
    expect((await decide(approval.id, 'approve', asBoleDesk)).statusCode).toBe(403);
    expect((await decide(approval.id, 'approve', asCoordinator)).statusCode).toBe(403);

    const res = await decide(approval.id, 'approve');
    expect(res.statusCode, res.body).toBe(200);
    expect(approvalSchema.parse(res.json())).toMatchObject({
      status: 'approved',
      decidedBy: { name: 'First Admin' },
    });

    const after = await invoiceNow(invoice.id);
    expect(after).toMatchObject({
      subtotal: TOTAL,
      discountTotal: 45_000,
      total: 405_000,
      balance: 405_000,
    });
    // 10% comes off the last instalment first; the earliest is untouched.
    expect(after.installments.map((i) => i.amount)).toEqual([225_000, 135_000, 45_000]);
    expect(after.installments.reduce((s, i) => s + i.amount, 0)).toBe(after.total);

    expect(code(await decide(approval.id, 'approve'))).toBe('APPROVAL_ALREADY_DECIDED');
  });

  it('never lets anyone approve their own request', async () => {
    const { invoice } = await freshInvoice();
    const req = await requestDiscount(invoice.id, { kind: 'fixed', value: 10_000 }, asAdmin);
    const approval = approvalSchema.parse(req.json());
    const own = await decide(approval.id, 'approve', asAdmin);
    expect(own.statusCode).toBe(403);
    expect(code(own)).toBe('SELF_APPROVAL');
    expect((await invoiceNow(invoice.id)).discountTotal).toBe(0);

    // The database refuses it too, whatever the API does.
    await expect(
      withDb((c) =>
        c.query(
          "UPDATE approval_requests SET status = 'approved', decided_by = requested_by, decided_at = now() WHERE id = $1",
          [approval.id],
        ),
      ),
    ).rejects.toThrow(/approval_requests_separation_check/);

    expect((await decide(approval.id, 'approve', asSecondAdmin)).statusCode).toBe(200);
    expect((await invoiceNow(invoice.id)).discountTotal).toBe(10_000);
  });

  it('changes nothing when rejected, and freezes the decision', async () => {
    const { invoice } = await freshInvoice();
    const approval = approvalSchema.parse(
      (await requestDiscount(invoice.id, { kind: 'fixed', value: 50_000 })).json(),
    );
    expect(approvalSchema.parse((await decide(approval.id, 'reject')).json()).status).toBe(
      'rejected',
    );
    expect((await invoiceNow(invoice.id)).discountTotal).toBe(0);
    await expect(
      withDb((c) =>
        c.query(
          "UPDATE approval_requests SET status = 'pending', decided_by = NULL WHERE id = $1",
          [approval.id],
        ),
      ),
    ).rejects.toThrow(/decided approval cannot be changed/);
    await expect(
      withDb((c) =>
        c.query("UPDATE approval_requests SET summary = 'edited' WHERE id = $1", [approval.id]),
      ),
    ).rejects.toThrow(/cannot be changed/);
  });

  it('allows one open request at a time, and refuses silly amounts and other branches', async () => {
    const { invoice } = await freshInvoice();
    expect((await requestDiscount(invoice.id, { kind: 'fixed', value: 1000 })).statusCode).toBe(
      201,
    );
    const again = await requestDiscount(invoice.id, { kind: 'fixed', value: 2000 });
    expect(again.statusCode).toBe(409);
    expect(code(again)).toBe('REQUEST_ALREADY_PENDING');

    const other = await freshInvoice();
    expect(code(await requestDiscount(other.invoice.id, { kind: 'fixed', value: TOTAL + 1 }))).toBe(
      'DISCOUNT_TOO_LARGE',
    );
    expect(
      code(
        await requestDiscount(other.invoice.id, {
          kind: 'fixed',
          value: 1000,
          reasonCode: 'made_up',
        }),
      ),
    ).toBe('INVALID_LIST_VALUE');
    expect(
      (await requestDiscount(other.invoice.id, { kind: 'percent', value: 12000 })).statusCode,
    ).toBe(400);

    const elsewhere = await enrollStudent(piassaCohort.id);
    const piassaInvoice = await createInvoice(elsewhere.enrollment.id, asAdmin);
    expect(
      (await requestDiscount(piassaInvoice.id, { kind: 'fixed', value: 1000 })).statusCode,
    ).toBe(403);
  });

  it('refuses at approval time if payments have since used up what would be discounted', async () => {
    const { invoice } = await freshInvoice();
    const approval = approvalSchema.parse(
      (await requestDiscount(invoice.id, { kind: 'fixed', value: 100_000 })).json(),
    );
    await payOk(invoice.id, TOTAL - 50_000);
    const res = await decide(approval.id, 'approve');
    expect(res.statusCode).toBe(422);
    expect(code(res)).toBe('DISCOUNT_TOO_LARGE');
    // The request is still open, and the invoice untouched.
    const list = approvalListResponseSchema.parse(
      (await asAdmin('GET', '/approvals?status=pending&limit=100')).json(),
    );
    expect(list.items.some((a) => a.id === approval.id)).toBe(true);
    expect((await invoiceNow(invoice.id)).discountTotal).toBe(0);
  });

  it('lets only one of two simultaneous decisions through', async () => {
    const { invoice } = await freshInvoice();
    const approval = approvalSchema.parse(
      (await requestDiscount(invoice.id, { kind: 'fixed', value: 20_000 })).json(),
    );
    const results = await Promise.all([
      decide(approval.id, 'approve', asAdmin),
      decide(approval.id, 'approve', asSecondAdmin),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await invoiceNow(invoice.id)).discountTotal).toBe(20_000);
  });

  it('shows deciders every request and everyone else only their own', async () => {
    const { invoice } = await freshInvoice();
    await requestDiscount(invoice.id, { kind: 'fixed', value: 500 });
    const mine = approvalListResponseSchema.parse(
      (await asBoleDesk('GET', '/approvals?limit=100')).json(),
    );
    const all = approvalListResponseSchema.parse(
      (await asAdmin('GET', '/approvals?limit=100')).json(),
    );
    expect(mine.items.length).toBeGreaterThan(0);
    expect(mine.items.every((a) => a.requestedBy.name === 'Test Staff')).toBe(true);
    expect(all.items.length).toBeGreaterThan(mine.items.length);
  });
});

describe('voiding a payment', () => {
  const requestVoid = (paymentId: string, who = asBoleDesk) =>
    who('POST', `/payments/${paymentId}/void-requests`, {
      reason: 'Entered against the wrong student',
    });

  it('reverses the money and voids the receipt, but keeps the receipt number used', async () => {
    const { invoice } = await freshInvoice();
    const payment = await payOk(invoice.id, 300_000);
    expect((await invoiceNow(invoice.id)).paidTotal).toBe(300_000);

    const req = await requestVoid(payment.id);
    expect(req.statusCode, req.body).toBe(201);
    const approval = approvalSchema.parse(req.json());
    expect(approval.summary).toContain(payment.receiptNumber);
    // Nothing changes until it's approved.
    expect((await invoiceNow(invoice.id)).paidTotal).toBe(300_000);
    expect(
      (await asBoleDesk('POST', `/approvals/${approval.id}/decision`, { decision: 'approve' }))
        .statusCode,
    ).toBe(403);

    const res = await asAdmin('POST', `/approvals/${approval.id}/decision`, {
      decision: 'approve',
    });
    expect(res.statusCode, res.body).toBe(200);

    const voided = paymentSchema.parse((await asAdmin('GET', `/payments/${payment.id}`)).json());
    expect(voided).toMatchObject({ status: 'void', receiptNumber: payment.receiptNumber });
    expect(voided.voidedAt).not.toBeNull();
    const after = await invoiceNow(invoice.id);
    expect(after).toMatchObject({ status: 'issued', paidTotal: 0, balance: TOTAL });
    expect(after.installments.every((i) => i.paidAmount === 0)).toBe(true);

    // The next receipt continues the sequence: the voided number is not reused.
    const next = await payOk(invoice.id, 1000);
    expect(Number(next.receiptNumber.split('-')[3])).toBeGreaterThan(
      Number(payment.receiptNumber.split('-')[3]),
    );
    const receiptRow = await withDb((c) =>
      c.query('SELECT status FROM receipts WHERE number = $1', [payment.receiptNumber]),
    );
    expect(receiptRow.rows[0]).toMatchObject({ status: 'void' });

    // A voided payment can't be voided again.
    expect(code(await requestVoid(payment.id))).toBe('PAYMENT_NOT_POSTED');
  });

  it('reopens a settled invoice, and cannot be approved by whoever asked', async () => {
    const { invoice } = await freshInvoice();
    const payment = await payOk(invoice.id, TOTAL);
    expect((await invoiceNow(invoice.id)).status).toBe('paid');
    const approval = approvalSchema.parse((await requestVoid(payment.id, asAdmin)).json());
    expect(
      code(await asAdmin('POST', `/approvals/${approval.id}/decision`, { decision: 'approve' })),
    ).toBe('SELF_APPROVAL');
    expect((await invoiceNow(invoice.id)).status).toBe('paid');
    expect(
      (await asSecondAdmin('POST', `/approvals/${approval.id}/decision`, { decision: 'approve' }))
        .statusCode,
    ).toBe(200);
    expect(await invoiceNow(invoice.id)).toMatchObject({ status: 'issued', paidTotal: 0 });
  });

  it('is limited to the caller’s branch and needs a real reason', async () => {
    const elsewhere = await enrollStudent(piassaCohort.id);
    const invoice = await createInvoice(elsewhere.enrollment.id, asAdmin);
    const payment = paymentSchema.parse((await pay(invoice.id, 1000, {}, asAdmin)).json());
    expect((await requestVoid(payment.id)).statusCode).toBe(403);
    const { invoice: mine } = await freshInvoice();
    const own = await payOk(mine.id, 1000);
    expect(
      (await asBoleDesk('POST', `/payments/${own.id}/void-requests`, { reason: 'oops' }))
        .statusCode,
    ).toBe(400);
  });
});

describe('recorded money cannot be changed behind the API’s back', () => {
  it('has no way for the app role to delete or rewrite money records', async () => {
    const { invoice } = await freshInvoice();
    const payment = await payOk(invoice.id, 5000);
    await withDb(async (c) => {
      for (const table of [
        'payments',
        'receipts',
        'invoices',
        'installments',
        'payment_allocations',
        'fee_structures',
        'approval_requests',
        'discounts',
      ]) {
        await expect(c.query(`DELETE FROM ${table}`), `delete ${table}`).rejects.toThrow(
          /permission denied/,
        );
        await expect(c.query(`TRUNCATE ${table} CASCADE`), `truncate ${table}`).rejects.toThrow(
          /permission denied/,
        );
      }
      await expect(c.query('UPDATE payment_allocations SET amount = amount + 1')).rejects.toThrow(
        /permission denied/,
      );

      const change = (sqlText: string) => expect(c.query(sqlText, [payment.id]));
      await change('UPDATE payments SET amount = amount + 1 WHERE id = $1').rejects.toThrow(
        /Column amount of payments cannot be changed/,
      );
      await change("UPDATE payments SET method = 'cheque' WHERE id = $1").rejects.toThrow(
        /cannot be changed/,
      );
      await change(
        "UPDATE receipts SET number = 'RCP-FAKE-1' WHERE payment_id = $1",
      ).rejects.toThrow(/cannot be changed/);
      await change(
        'UPDATE invoices SET subtotal = 1, total = 1 WHERE id = (SELECT invoice_id FROM payments WHERE id = $1)',
      ).rejects.toThrow(/cannot be changed/);
      await change(
        "UPDATE invoices SET number = 'INV-FAKE' WHERE id = (SELECT invoice_id FROM payments WHERE id = $1)",
      ).rejects.toThrow(/cannot be changed/);
      await change(
        'UPDATE fee_structures SET total = total + 1 WHERE id = (SELECT id FROM fee_structures LIMIT 1) AND $1::uuid IS NOT NULL',
      ).rejects.toThrow(/cannot be changed/);
    });
  });

  it('refuses inconsistent totals however they are written', async () => {
    const { invoice } = await freshInvoice();
    await withDb(async (c) => {
      await expect(
        c.query('UPDATE installments SET paid_amount = amount + 1 WHERE invoice_id = $1', [
          invoice.id,
        ]),
      ).rejects.toThrow(/installments_paid_check/);
      await expect(
        c.query('UPDATE invoices SET paid_total = total + 1 WHERE id = $1', [invoice.id]),
      ).rejects.toThrow(/invoices_paid_check/);
      await expect(
        c.query('UPDATE invoices SET discount_total = 5 WHERE id = $1', [invoice.id]),
      ).rejects.toThrow(/invoices_total_check/);
      await expect(
        c.query("UPDATE invoices SET status = 'refunded' WHERE id = $1", [invoice.id]),
      ).rejects.toThrow(/invoices_status_check/);
    });
  });
});

describe('the books balance', () => {
  it('has matching totals on every invoice after everything above', async () => {
    await withDb(async (c) => {
      // Invoice total = sum of its instalments; paid = sum of instalments' paid.
      const drift = await c.query(`
        SELECT i.number FROM invoices i
        JOIN (SELECT invoice_id, sum(amount) AS amount, sum(paid_amount) AS paid FROM installments GROUP BY invoice_id) p
          ON p.invoice_id = i.id
        WHERE i.total <> p.amount OR i.paid_total <> p.paid OR i.total <> i.subtotal - i.discount_total`);
      expect(drift.rows).toEqual([]);

      // Each instalment's paid amount = allocations from payments that are still posted.
      const allocations = await c.query(`
        SELECT n.id FROM installments n
        LEFT JOIN (
          SELECT a.installment_id, sum(a.amount) AS total
          FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE p.status = 'posted'
          GROUP BY a.installment_id
        ) s ON s.installment_id = n.id
        WHERE n.paid_amount <> coalesce(s.total, 0)`);
      expect(allocations.rows).toEqual([]);

      // A payment's allocations add up to the payment itself.
      const split = await c.query(`
        SELECT p.id FROM payments p JOIN payment_allocations a ON a.payment_id = p.id
        GROUP BY p.id, p.amount HAVING sum(a.amount) <> p.amount`);
      expect(split.rows).toEqual([]);

      // Status agrees with the money, and every payment has exactly one receipt.
      const status = await c.query(`
        SELECT number FROM invoices WHERE status <> 'void' AND status <> CASE
          WHEN paid_total >= total THEN 'paid' WHEN paid_total > 0 THEN 'partially_paid' ELSE 'issued' END`);
      expect(status.rows).toEqual([]);
      const receiptless = await c.query(
        'SELECT p.id FROM payments p LEFT JOIN receipts r ON r.payment_id = p.id WHERE r.id IS NULL',
      );
      expect(receiptless.rows).toEqual([]);
    });
  });
});
