import { randomUUID } from 'node:crypto';

import {
  approvalSchema,
  auditListResponseSchema,
  branchSchema,
  cohortSchema,
  courseSchema,
  departmentSchema,
  enrollResponseSchema,
  feeStructureSchema,
  invoiceSchema,
  outstandingItemsResponseSchema,
  outstandingResponseSchema,
  paymentPlanSchema,
  paymentSchema,
  problemDetailsSchema,
  programSchema,
  revenueResponseSchema,
  roomSchema,
  shiftSchema,
  studentSchema,
} from '@emis/contracts';
import { roles, rolePermissions, userRoleAssignments } from '@emis/db';
import { createIsolatedDatabase, type TestDatabaseUrls } from '@emis/db/testing';
import type { Scope } from '@emis/permissions';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import { ClsService } from 'nestjs-cls';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { DbAdapter } from '../../database/database.module.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { callAs, createStaff, type StaffFixture } from '../../testing/staff-fixtures.js';

// Own database: report totals must count only what this file records.
let urls: TestDatabaseUrls;
let app: NestFastifyApplication;
let asAdmin: ReturnType<typeof callAs>;
let asAdmin2: ReturnType<typeof callAs>;
let asCoordinator: ReturnType<typeof callAs>;

let bole: { id: string };
let piassa: { id: string };
let language: { id: string };
let computer: { id: string };
const payment = {} as Record<'s1cash' | 's1bank' | 's2' | 's3' | 's5', string>;

const code = (res: LightMyRequestResponse) => problemDetailsSchema.parse(res.json()).code;
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

/** A staff member with a custom role that only holds `reports.finance`, limited to one scope. */
async function financeViewer(email: string, scope: Scope): Promise<StaffFixture> {
  const staff = await createStaff(app, { email });
  await app.get(ClsService).run(async () => {
    const db = app.get<TransactionHost<DbAdapter>>(TransactionHost).tx;
    const [role] = await db
      .insert(roles)
      .values({
        key: `viewer_${randomUUID().slice(0, 8)}`,
        name: 'Finance viewer',
        allowedScopes: ['global', 'branch', 'department'],
      })
      .returning({ id: roles.id });
    if (!role) throw new Error('role not created');
    await db.insert(rolePermissions).values({ roleId: role.id, permission: 'reports.finance' });
    await db.insert(userRoleAssignments).values({
      userId: staff.userId,
      roleId: role.id,
      scopeType: scope.type,
      scopeId: scope.type === 'global' ? null : scope.id,
    });
  });
  return staff;
}

/** Recorded payments can't be edited, so a test that needs an old one lifts the guard as superuser. */
async function backdate(paymentId: string, receivedAt: string) {
  const client = new pg.Client({ connectionString: urls.adminUrl });
  await client.connect();
  try {
    await client.query('ALTER TABLE payments DISABLE TRIGGER payments_immutable');
    await client.query('UPDATE payments SET received_at = $1 WHERE id = $2', [
      receivedAt,
      paymentId,
    ]);
    await client.query('ALTER TABLE payments ENABLE TRIGGER payments_immutable');
  } finally {
    await client.end();
  }
}

const revenue = async (query = '', who = asAdmin) => {
  const res = await who('GET', `/reports/revenue${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return revenueResponseSchema.parse(res.json());
};
const outstanding = async (query = '', who = asAdmin) => {
  const res = await who('GET', `/reports/outstanding${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return outstandingResponseSchema.parse(res.json());
};
const amounts = (rows: { key: string; amount: number }[]) =>
  Object.fromEntries(rows.map((r) => [r.key, r.amount]));
const byBucket = (report: Awaited<ReturnType<typeof outstanding>>) =>
  Object.fromEntries(report.buckets.map((b) => [b.bucket, [b.count, b.amount]]));

let phone = 0;
const student = async (branchId: string, givenName: string) =>
  studentSchema.parse(
    (
      await asAdmin(
        'POST',
        '/students',
        {
          givenName,
          fatherName: `Family${String(++phone).padStart(3, '0')}`,
          gender: 'female',
          phone: `09${String(70_000_000 + phone)}`,
          branchId,
          confirmNotDuplicate: true,
        },
        key(),
      )
    ).json(),
  );

let week = 0;
async function openClass(courseId: string, roomId: string, shiftId: string) {
  const start = plusDays(todayAddis(), 14 + 7 * week++);
  const made = await post(
    asAdmin,
    '/cohorts',
    {
      name: `Class ${week}`,
      courseId,
      shiftId,
      roomId,
      maxSize: 20,
      startDate: start,
      endDate: plusDays(start, 4),
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
  return made;
}

async function bill(
  studentId: string,
  cohortId: string,
  pay?: { amount: number; method?: string; reference?: string },
) {
  const enrolled = enrollResponseSchema.parse(
    (await asAdmin('POST', '/enrollments', { studentId, cohortId }, key())).json(),
  );
  const invoice = invoiceSchema.parse(
    (await asAdmin('POST', '/invoices', { enrollmentId: enrolled.enrollment.id }, key())).json(),
  );
  if (!pay) return { invoice, payment: null };
  const made = await post(
    asAdmin,
    '/payments',
    {
      invoiceId: invoice.id,
      amount: pay.amount,
      method: pay.method ?? 'cash',
      reference: pay.reference,
    },
    paymentSchema,
  );
  return { invoice, payment: made };
}

beforeAll(async () => {
  urls = await createIsolatedDatabase(inject('database'), 'emis_reports_test');
  app = await createTestApp({ env: { DATABASE_URL: urls.appUrl, RATE_LIMIT_MAX: '100000' } });
  asAdmin = callAs(
    app,
    await createStaff(app, { email: 'rep-admin@lingua.test', roleKey: 'admin' }),
  );
  asAdmin2 = callAs(
    app,
    await createStaff(app, { email: 'rep-admin2@lingua.test', roleKey: 'admin' }),
  );
  asCoordinator = callAs(
    app,
    await createStaff(app, { email: 'rep-coord@lingua.test', roleKey: 'coordinator' }),
  );

  await asAdmin('PATCH', '/institution', { name: 'Lingua', primaryColor: '#0f766e' }, ifMatch(1));
  language = await post(
    asAdmin,
    '/departments',
    { code: 'LANG', name: 'Language' },
    departmentSchema,
  );
  computer = await post(
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
  const shift = await post(
    asAdmin,
    '/shifts',
    { code: 'EVE', name: 'Evening', daysOfWeek: [1, 3, 5], startTime: '17:00', endTime: '19:00' },
    shiftSchema,
  );
  const roomBole = await post(
    asAdmin,
    '/rooms',
    { branchId: bole.id, code: 'R1', name: 'R1', type: 'classroom', capacity: 30 },
    roomSchema,
  );
  const roomPiassa = await post(
    asAdmin,
    '/rooms',
    { branchId: piassa.id, code: 'R2', name: 'R2', type: 'classroom', capacity: 30 },
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
  await asAdmin(
    'POST',
    '/descriptors',
    { namespace: 'withdrawal_reason', code: 'other', label: 'Other' },
    key(),
  );

  const engBole = await openClass(a1.id, roomBole.id, shift.id);
  const pyBole = await openClass(py1.id, roomBole.id, shift.id);
  const engPiassa = await openClass(a1.id, roomPiassa.id, shift.id);

  const s1 = await bill((await student(bole.id, 'Abebe')).id, engBole.id, { amount: 50_000 });
  payment.s1cash = s1.payment!.id;
  payment.s1bank = (
    await post(
      asAdmin,
      '/payments',
      { invoiceId: s1.invoice.id, amount: 10_000, method: 'bank_transfer', reference: 'CBE-1' },
      paymentSchema,
    )
  ).id;
  payment.s2 = (
    await bill((await student(bole.id, 'Selam')).id, pyBole.id, { amount: 25_000 })
  ).payment!.id;
  payment.s3 = (
    await bill((await student(piassa.id, 'Hana')).id, engPiassa.id, {
      amount: 30_000,
      method: 'cheque',
      reference: 'CHQ-9',
    })
  ).payment!.id;
  // A name a spreadsheet would run as a formula, unpaid.
  await bill((await student(bole.id, '=HYPERLINK("http://x.test","click")')).id, engBole.id);
  // Paid, then voided: it must leave the totals and show as voided.
  const s5 = await bill((await student(bole.id, 'Dawit')).id, engBole.id, { amount: 20_000 });
  payment.s5 = s5.payment!.id;
  const request = approvalSchema.parse(
    (
      await asAdmin2('POST', `/payments/${payment.s5}/void-requests`, {
        reason: 'Entered twice by mistake',
      })
    ).json(),
  );
  expect(
    (await asAdmin('POST', `/approvals/${request.id}/decision`, { decision: 'approve' }))
      .statusCode,
  ).toBe(200);
});

afterAll(async () => {
  await app?.close();
});

describe('revenue', () => {
  it('adds up what was received and leaves the voided payment out', async () => {
    const report = await revenue();
    expect(report.totals).toEqual({
      count: 4,
      amount: 115_000,
      voidedCount: 1,
      voidedAmount: 20_000,
    });
    expect(report.currency).toBe('ETB');
    expect(report.rows).toEqual([
      { key: todayAddis(), label: todayAddis(), count: 4, amount: 115_000 },
    ]);
  });

  it('groups by department, branch, program and method', async () => {
    const dept = await revenue('?groupBy=department');
    expect(dept.rows.map((r) => r.label)).toEqual(['Language', 'Computer']);
    expect(dept.rows.map((r) => r.amount)).toEqual([90_000, 25_000]);

    expect(amounts((await revenue('?groupBy=branch')).rows)).toEqual({
      [bole.id]: 85_000,
      [piassa.id]: 30_000,
    });
    expect((await revenue('?groupBy=program')).rows.map((r) => [r.label, r.amount])).toEqual([
      ['English', 90_000],
      ['Python', 25_000],
    ]);
    const method = await revenue('?groupBy=method');
    expect(method.rows.map((r) => [r.label, r.amount])).toEqual([
      ['Cash', 75_000],
      ['Cheque', 30_000],
      ['Bank transfer', 10_000],
    ]);
  });

  it('every grouping adds up to the same total', async () => {
    for (const groupBy of ['day', 'month', 'branch', 'department', 'program', 'method']) {
      const report = await revenue(`?groupBy=${groupBy}`);
      expect(
        report.rows.reduce((n, r) => n + r.amount, 0),
        groupBy,
      ).toBe(115_000);
      expect(report.totals.amount, groupBy).toBe(115_000);
    }
  });

  it('filters by branch, department and method', async () => {
    expect((await revenue(`?branchId=${piassa.id}`)).totals.amount).toBe(30_000);
    expect((await revenue(`?departmentId=${computer.id}`)).totals.amount).toBe(25_000);
    expect((await revenue('?method=bank_transfer')).totals.amount).toBe(10_000);
    expect(
      (await revenue(`?branchId=${piassa.id}&departmentId=${computer.id}`)).totals.amount,
    ).toBe(0);
  });

  it('agrees with what the invoices say was paid', async () => {
    const client = new pg.Client({ connectionString: urls.adminUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ paid: string }>(
        'SELECT coalesce(sum(paid_total), 0) AS paid FROM invoices',
      );
      expect(Number(rows[0]?.paid)).toBe(115_000);
    } finally {
      await client.end();
    }
  });

  it('refuses a backwards range, a huge range and junk', async () => {
    const backwards = await asAdmin('GET', '/reports/revenue?from=2026-05-02&to=2026-05-01');
    expect(backwards.statusCode).toBe(422);
    expect(code(backwards)).toBe('INVALID_DATE_RANGE');
    const huge = await asAdmin('GET', '/reports/revenue?from=2015-01-01&to=2026-01-01');
    expect(huge.statusCode).toBe(422);
    expect(code(huge)).toBe('DATE_RANGE_TOO_LARGE');
    for (const bad of ['?from=yesterday', '?groupBy=colour', '?method=barter', '?branchId=nope']) {
      expect((await asAdmin('GET', `/reports/revenue${bad}`)).statusCode, bad).toBe(400);
    }
  });
});

describe('outstanding balances', () => {
  it('counts every unpaid instalment, none of them overdue today', async () => {
    const report = await outstanding();
    expect(report.totals).toMatchObject({
      count: 13,
      amount: 335_000,
      overdueCount: 0,
      overdueAmount: 0,
    });
    expect(byBucket(report)).toEqual({
      not_due: [13, 335_000],
      d1_30: [0, 0],
      d31_60: [0, 0],
      d61_90: [0, 0],
      d90_plus: [0, 0],
    });
  });

  it('ages instalments as time passes', async () => {
    const at = (days: number) => `?asOf=${plusDays(todayAddis(), days)}`;
    const t45 = await outstanding(at(45));
    expect(byBucket(t45)).toEqual({
      not_due: [5, 90_000],
      d1_30: [5, 125_000],
      d31_60: [3, 120_000],
      d61_90: [0, 0],
      d90_plus: [0, 0],
    });
    expect(t45.totals).toMatchObject({ amount: 335_000, overdueCount: 8, overdueAmount: 245_000 });

    const t100 = await outstanding(at(100));
    expect(byBucket(t100)).toEqual({
      not_due: [0, 0],
      d1_30: [0, 0],
      d31_60: [5, 90_000],
      d61_90: [5, 125_000],
      d90_plus: [3, 120_000],
    });
  });

  it('counts the voided payment as still owed', async () => {
    const items = outstandingItemsResponseSchema.parse(
      (
        await asAdmin(
          'GET',
          `/reports/outstanding/items?asOf=${plusDays(todayAddis(), 45)}&bucket=d31_60&limit=50`,
        )
      ).json(),
    );
    const dawit = items.items.filter((i) => i.studentName.startsWith('Dawit'));
    expect(dawit).toHaveLength(1);
    expect(dawit[0]).toMatchObject({
      owed: 50_000,
      sequence: 1,
      bucket: 'd31_60',
      daysOverdue: 45,
    });
  });

  it('lists the instalments behind a bucket, oldest first, paging without repeats', async () => {
    const asOf = plusDays(todayAddis(), 45);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await asAdmin(
        'GET',
        `/reports/outstanding/items?asOf=${asOf}&limit=4${cursor ? `&cursor=${cursor}` : ''}`,
      );
      expect(res.statusCode, res.body).toBe(200);
      const page = outstandingItemsResponseSchema.parse(res.json());
      seen.push(...page.items.map((i) => i.installmentId));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(13);
    expect(new Set(seen).size).toBe(13);
    expect((await asAdmin('GET', '/reports/outstanding/items?cursor=garbage')).statusCode).toBe(
      400,
    );
  });

  it('filters by branch and department', async () => {
    expect((await outstanding(`?branchId=${piassa.id}`)).totals).toMatchObject({
      count: 3,
      amount: 70_000,
    });
    expect((await outstanding(`?departmentId=${computer.id}`)).totals).toMatchObject({
      count: 2,
      amount: 25_000,
    });
  });
});

describe('who sees what', () => {
  it('is closed to everyone without the finance permission', async () => {
    expect((await asCoordinator('GET', '/reports/revenue')).statusCode).toBe(403);
    expect((await callAs(app, null)('GET', '/reports/revenue')).statusCode).toBe(401);
  });

  it('limits a branch-scoped viewer to their branch', async () => {
    const viewer = callAs(
      app,
      await financeViewer('rep-bole@lingua.test', { type: 'branch', id: bole.id }),
    );
    expect((await revenue('', viewer)).totals.amount).toBe(85_000);
    expect((await outstanding('', viewer)).totals.amount).toBe(335_000 - 70_000);
    // Asking for the other branch doesn't get around the limit.
    expect((await revenue(`?branchId=${piassa.id}`, viewer)).totals.amount).toBe(0);
  });

  it('limits a department-scoped viewer to their department', async () => {
    const viewer = callAs(
      app,
      await financeViewer('rep-comp@lingua.test', { type: 'department', id: computer.id }),
    );
    expect((await revenue('', viewer)).totals.amount).toBe(25_000);
    expect((await outstanding('', viewer)).totals).toMatchObject({ count: 2, amount: 25_000 });
    expect((await revenue(`?departmentId=${language.id}`, viewer)).totals.amount).toBe(0);
  });
});

describe('CSV export', () => {
  it('downloads the revenue report as a spreadsheet file', async () => {
    const res = await asAdmin('GET', '/reports/revenue.csv?groupBy=method');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(String(res.headers['content-disposition'])).toContain('attachment; filename="revenue-');
    const text = res.body;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('Method,Payments,Amount (ETB)');
    expect(text).toContain('Cash,2,750.00');
    expect(text).toContain('Total,4,1150.00');
  });

  it('defuses a name that would run as a spreadsheet formula', async () => {
    const res = await asAdmin('GET', '/reports/outstanding.csv');
    expect(res.statusCode, res.body).toBe(200);
    const lines = res.body.split('\r\n');
    expect(lines[0]).toContain(
      'Student number,Student,Invoice,Instalment,Due date,Days overdue,Age,Owed (ETB)',
    );
    expect(lines.filter((l) => l.length > 0)).toHaveLength(1 + 13);
    const formulaRow = lines.find((l) => l.includes('HYPERLINK')) ?? '';
    expect(formulaRow).toContain(`"'=HYPERLINK(""http://x.test"",""click"") Family`);
    expect(lines.some((l) => /^[=+@-]/.test(l.split(',')[1] ?? ''))).toBe(false);
  });

  it('is limited like the reports are', async () => {
    const viewer = callAs(
      app,
      await financeViewer('rep-csv@lingua.test', { type: 'branch', id: piassa.id }),
    );
    const res = await viewer('GET', '/reports/outstanding.csv');
    expect(res.body.split('\r\n').filter((l) => l.length > 0)).toHaveLength(1 + 3);
    expect((await asCoordinator('GET', '/reports/outstanding.csv')).statusCode).toBe(403);
  });

  it('records each export without the rows in it', async () => {
    const res = await asAdmin('GET', '/audit-log?limit=100');
    const entries = auditListResponseSchema
      .parse(res.json())
      .items.filter((e) => e.action === 'report.exported');
    expect(entries.length).toBeGreaterThanOrEqual(3);
    expect(entries.map((e) => (e.changes as { report: string }).report)).toEqual(
      expect.arrayContaining(['revenue', 'outstanding']),
    );
    expect(res.body).not.toContain('HYPERLINK');
  });
});

describe('dates', () => {
  it('puts a payment on the day and month it happened in the institution’s time zone', async () => {
    // 21:30 UTC on 30 April is already 1 May in Addis Ababa (UTC+3).
    await backdate(payment.s1bank, '2026-04-30T21:30:00.000Z');
    await backdate(payment.s3, '2026-03-15T09:00:00.000Z');

    const months = await revenue('?from=2026-03-01&to=2026-05-31&groupBy=month');
    expect(amounts(months.rows)).toEqual({ '2026-03': 30_000, '2026-05': 10_000 });

    expect((await revenue('?from=2026-04-30&to=2026-04-30')).totals.amount).toBe(0);
    expect((await revenue('?from=2026-05-01&to=2026-05-01')).totals.amount).toBe(10_000);
  });

  it('shows only the current month by default, so older payments drop out', async () => {
    const report = await revenue();
    expect(report.totals.amount).toBe(115_000 - 30_000 - 10_000);
  });

  it('includes the last day of the range in full', async () => {
    const today = todayAddis();
    expect((await revenue(`?from=${today}&to=${today}`)).totals.amount).toBe(75_000);
  });
});
