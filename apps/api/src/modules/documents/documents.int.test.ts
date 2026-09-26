import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  approvalSchema,
  auditListResponseSchema,
  branchSchema,
  certificateListResponseSchema,
  certificateSchema,
  cohortSchema,
  courseSchema,
  departmentSchema,
  enrollResponseSchema,
  feeStructureSchema,
  institutionSchema,
  invoiceSchema,
  paymentPlanSchema,
  paymentSchema,
  problemDetailsSchema,
  programSchema,
  roomSchema,
  shiftSchema,
  studentCardSchema,
  studentSchema,
  verificationSchema,
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
import { createTestAppWithMailer, type TestApp } from '../../testing/create-test-app.js';
import { callAs, createStaff, type StaffFixture } from '../../testing/staff-fixtures.js';
import { FeeRemindersService } from '../billing/index.js';

// Own database: serial numbers are counted from 1, and module switches are global.
let urls: TestDatabaseUrls;
let app: NestFastifyApplication;
let mailApp: TestApp;
let asAdmin: ReturnType<typeof callAs>;
let asBoleDesk: ReturnType<typeof callAs>;
let asCoordinator: ReturnType<typeof callAs>;
let adminFixture: StaffFixture;

let bole: { id: string };
let piassa: { id: string };
let course: { id: string; version: number };
let noCert: { id: string };
let computer: { id: string };
let room: { id: string };
let shift: { id: string };
let openCohortId: string;
const WEB = 'https://verify.example.test';

// A stand-in for Gotenberg: records the HTML it's sent and answers with a tiny "PDF".
let stub: Server;
const rendered: string[] = [];
let stubFails = false;
const lastHtml = () => rendered[rendered.length - 1] ?? '';

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

let weekCounter = 0;
function nextWeek() {
  const start = new Date(Date.UTC(2027, 0, 4 + 7 * weekCounter++));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 4);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

const openCohort = async (courseId: string, roomId = room.id) => {
  const made = await post(
    asAdmin,
    '/cohorts',
    {
      name: `Class ${randomUUID().slice(0, 6)}`,
      courseId,
      shiftId: shift.id,
      roomId,
      maxSize: 30,
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
const nextStudent = async (extra: Record<string, unknown> = {}, who = asBoleDesk) => {
  const n = ++studentCounter;
  const res = await who(
    'POST',
    '/students',
    {
      givenName: `Holder${n}`,
      fatherName: `Family${String(n).padStart(3, '0')}`,
      gender: 'female',
      phone: `09${String(40_000_000 + n)}`,
      branchId: bole.id,
      confirmNotDuplicate: true,
      ...extra,
    },
    key(),
  );
  expect(res.statusCode, res.body).toBe(201);
  return studentSchema.parse(res.json());
};

/** A student enrolled in a class of the given course. */
const enrolled = async (cohortId: string, extra: Record<string, unknown> = {}) => {
  const student = await nextStudent(extra);
  const res = await asAdmin('POST', '/enrollments', { studentId: student.id, cohortId }, key());
  expect(res.statusCode, res.body).toBe(201);
  return { student, enrollment: enrollResponseSchema.parse(res.json()).enrollment };
};

/** Enrolled and marked as having completed the course. */
const completed = async (cohortId: string, extra: Record<string, unknown> = {}) => {
  const made = await enrolled(cohortId, extra);
  const res = await asAdmin(
    'POST',
    `/enrollments/${made.enrollment.id}/result`,
    {},
    ifMatch(made.enrollment.version),
  );
  expect(res.statusCode, res.body).toBe(200);
  return made;
};

const withDb = async <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> => {
  const client = new pg.Client({ connectionString: urls.appUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
};

const tokenOf = async (table: 'certificates' | 'student_cards', id: string) =>
  withDb(
    async (c) =>
      (await c.query<{ token: string }>(`SELECT token FROM ${table} WHERE id = $1`, [id])).rows[0]!
        .token,
  );

const todayAddis = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date());
const plusDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  stub = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const start = body.indexOf('<!doctype html>');
      if (stubFails) {
        res.writeHead(500);
        res.end('chromium exploded: /internal/path');
      } else if (req.url === '/forms/chromium/convert/html' && start >= 0) {
        rendered.push(body.slice(start, body.indexOf('</html>', start) + 7));
        res.writeHead(200, { 'content-type': 'application/pdf' });
        res.end('%PDF-1.4 stand-in');
      } else {
        res.writeHead(400);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const gotenberg = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;

  urls = await createIsolatedDatabase(inject('database'), 'emis_documents_test');
  const env = {
    DATABASE_URL: urls.appUrl,
    RATE_LIMIT_MAX: '100000',
    GOTENBERG_URL: gotenberg,
    WEB_URL: WEB,
  };
  mailApp = await createTestAppWithMailer({ env });
  app = mailApp.app;

  adminFixture = await createStaff(app, { email: 'docs-admin@lingua.test', roleKey: 'admin' });
  asAdmin = callAs(app, adminFixture);

  await asAdmin(
    'PATCH',
    '/institution',
    { name: 'Lingua Institute', primaryColor: '#0f766e' },
    ifMatch(1),
  );
  const language = await post(
    asAdmin,
    '/departments',
    { code: 'LANG', name: 'Language' },
    departmentSchema,
  );
  const comp = await post(
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
    { departmentId: comp.id, code: 'PYTH', name: 'Python', type: 'short_course' },
    programSchema,
  );
  course = await post(
    asAdmin,
    '/courses',
    { programId: english.id, code: 'A1', name: 'English A1' },
    courseSchema,
  );
  noCert = await post(
    asAdmin,
    '/courses',
    { programId: english.id, code: 'WKS', name: 'Workshop', certificateEligible: false },
    courseSchema,
  );
  computer = await post(
    asAdmin,
    '/courses',
    { programId: python.id, code: 'PY1', name: 'Python 1' },
    courseSchema,
  );

  shift = await post(
    asAdmin,
    '/shifts',
    { code: 'EVE', name: 'Evening', daysOfWeek: [1, 3, 5], startTime: '17:00', endTime: '19:00' },
    shiftSchema,
  );
  room = await post(
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
  openCohortId = (await openCohort(course.id)).id;
  void piassaRoom;

  for (const [courseId, amount] of [
    [course.id, 150_000],
    [noCert.id, 50_000],
    [computer.id, 80_000],
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
  await post(
    asAdmin,
    '/descriptors',
    { namespace: 'withdrawal_reason', code: 'other', label: 'Other' },
    { parse: (v: unknown) => v },
  );

  const desk = await createStaff(app, { email: 'docs-desk@lingua.test' });
  await grantRole(desk, 'secretary', { type: 'branch', id: bole.id });
  asBoleDesk = callAs(app, desk);
  const coordinator = await createStaff(app, { email: 'docs-coord@lingua.test' });
  await grantRole(coordinator, 'coordinator', { type: 'department', id: language.id });
  asCoordinator = callAs(app, coordinator);
});
afterAll(async () => {
  await mailApp.app.close();
  await new Promise((resolve) => stub.close(resolve));
});

describe('receipt PDFs', () => {
  const invoiceAndPayment = async (amount = 50_000, extra: Record<string, unknown> = {}) => {
    const { student, enrollment } = await enrolled(openCohortId, extra);
    const invoice = invoiceSchema.parse(
      (await asBoleDesk('POST', '/invoices', { enrollmentId: enrollment.id }, key())).json(),
    );
    const payment = paymentSchema.parse(
      (
        await asBoleDesk(
          'POST',
          '/payments',
          { invoiceId: invoice.id, amount, method: 'bank_transfer', reference: 'CBE-77' },
          key(),
        )
      ).json(),
    );
    return { student, invoice, payment };
  };

  it('prints an A5 receipt by default, straight from the payment', async () => {
    const { student, payment } = await invoiceAndPayment(50_000);
    const res = await asBoleDesk('GET', `/payments/${payment.id}/receipt`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(String(res.headers['content-disposition'])).toContain(
      `receipt-${payment.receiptNumber}-a5.pdf`,
    );
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');

    const page = lastHtml();
    for (const text of [
      'size: A5',
      'Lingua Institute',
      payment.receiptNumber,
      'ETB 500.00',
      'bank transfer · CBE-77',
      student.givenName,
      'Instalment 1',
    ]) {
      expect(page).toContain(text);
    }
    expect(page).toContain('#0f766e');
    expect(page).not.toContain('VOID');
  });

  it('prints an 80 mm thermal receipt on request', async () => {
    const { payment } = await invoiceAndPayment(10_000);
    const res = await asBoleDesk('GET', `/payments/${payment.id}/receipt?format=thermal`);
    expect(res.statusCode).toBe(200);
    expect(lastHtml()).toContain('size: 80mm 190mm');
    expect(lastHtml()).toContain(payment.receiptNumber);
    expect((await asBoleDesk('GET', `/payments/${payment.id}/receipt?format=a3`)).statusCode).toBe(
      400,
    );
  });

  it('marks a voided payment’s receipt as void', async () => {
    const { payment } = await invoiceAndPayment(20_000);
    const request = approvalSchema.parse(
      (
        await asBoleDesk('POST', `/payments/${payment.id}/void-requests`, {
          reason: 'Entered twice by mistake',
        })
      ).json(),
    );
    expect(
      (await asAdmin('POST', `/approvals/${request.id}/decision`, { decision: 'approve' }))
        .statusCode,
    ).toBe(200);
    await asBoleDesk('GET', `/payments/${payment.id}/receipt`);
    expect(lastHtml()).toContain('VOID');
    expect(lastHtml()).toContain('no longer valid proof of payment');
  });

  it('respects branch limits and who may read billing', async () => {
    const { payment } = await invoiceAndPayment(5_000);
    expect((await asCoordinator('GET', `/payments/${payment.id}/receipt`)).statusCode).toBe(403);
    const elsewhere = await createStaff(app, { email: 'docs-piassa@lingua.test' });
    await grantRole(elsewhere, 'secretary', { type: 'branch', id: piassa.id });
    expect(
      (await callAs(app, elsewhere)('GET', `/payments/${payment.id}/receipt`)).statusCode,
    ).toBe(403);
    expect((await asBoleDesk('GET', `/payments/${randomUUID()}/receipt`)).statusCode).toBe(400);
  });

  it('answers 503, not a stack trace, when the PDF service fails', async () => {
    const { payment } = await invoiceAndPayment(1_000);
    stubFails = true;
    try {
      const res = await asBoleDesk('GET', `/payments/${payment.id}/receipt`);
      expect(res.statusCode).toBe(503);
      expect(code(res)).toBe('PDF_UNAVAILABLE');
      expect(res.body).not.toContain('chromium exploded');
    } finally {
      stubFails = false;
    }
    expect((await asBoleDesk('GET', `/payments/${payment.id}/receipt`)).statusCode).toBe(200);
  });
});

describe('certificates', () => {
  it('needs a completed course that awards a certificate', async () => {
    const { enrollment } = await enrolled(openCohortId);
    const early = await asAdmin('POST', `/enrollments/${enrollment.id}/certificate`);
    expect(early.statusCode).toBe(422);
    expect(code(early)).toBe('NOT_ELIGIBLE_FOR_CERTIFICATE');

    const workshop = await openCohort(noCert.id);
    const done = await completed(workshop.id);
    const res = await asAdmin('POST', `/enrollments/${done.enrollment.id}/certificate`);
    expect(res.statusCode).toBe(422);
    expect(problemDetailsSchema.parse(res.json()).detail).toContain('does not award');
    expect((await asAdmin('POST', `/enrollments/${randomUUID()}/certificate`)).statusCode).toBe(
      400,
    );
  });

  it('issues a numbered certificate with the names as they were, once', async () => {
    const { student, enrollment } = await completed(openCohortId);
    const res = await asAdmin('POST', `/enrollments/${enrollment.id}/certificate`);
    expect(res.statusCode, res.body).toBe(201);
    const cert = certificateSchema.parse(res.json());
    expect(cert).toMatchObject({
      status: 'issued',
      studentName: `${student.givenName} ${student.fatherName}`,
      courseName: 'English A1',
      completedOn: todayAddis(),
      enrollmentId: enrollment.id,
    });
    expect(cert.serial).toMatch(/^CERT-\d{4}-\d{5}$/);

    const again = await asAdmin('POST', `/enrollments/${enrollment.id}/certificate`);
    expect(again.statusCode).toBe(409);
    expect(code(again)).toBe('CERTIFICATE_ALREADY_ISSUED');

    // The certificate keeps the name it was issued with, even if the record is corrected later.
    await asBoleDesk(
      'PATCH',
      `/students/${student.id}`,
      { givenName: 'Renamed' },
      ifMatch(student.version),
    );
    const stored = certificateSchema.parse(
      (await asAdmin('GET', `/certificates/${cert.id}`)).json(),
    );
    expect(stored.studentName).toBe(cert.studentName);
  });

  it('issues exactly one when asked many times at once, without skipping a serial', async () => {
    const { enrollment } = await completed(openCohortId);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => asAdmin('POST', `/enrollments/${enrollment.id}/certificate`)),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409, 409]);
    const winner = certificateSchema.parse(results.find((r) => r.statusCode === 201)!.json());
    const next = await completed(openCohortId);
    const following = certificateSchema.parse(
      (await asAdmin('POST', `/enrollments/${next.enrollment.id}/certificate`)).json(),
    );
    expect(Number(following.serial.split('-')[2])).toBe(Number(winner.serial.split('-')[2]) + 1);
  });

  it('can require the fees to be paid in full first', async () => {
    const { enrollment } = await completed(openCohortId);
    const invoice = invoiceSchema.parse(
      (await asBoleDesk('POST', '/invoices', { enrollmentId: enrollment.id }, key())).json(),
    );
    const institution = institutionSchema.parse((await asAdmin('GET', '/institution')).json());
    const on = await asAdmin(
      'PATCH',
      '/institution',
      { certificateRequiresPaidInFull: true },
      ifMatch(institution.version),
    );
    expect(institutionSchema.parse(on.json()).certificateRequiresPaidInFull).toBe(true);

    const blocked = await asAdmin('POST', `/enrollments/${enrollment.id}/certificate`);
    expect(blocked.statusCode).toBe(409);
    expect(code(blocked)).toBe('BALANCE_OUTSTANDING');

    await asBoleDesk(
      'POST',
      '/payments',
      { invoiceId: invoice.id, amount: invoice.total, method: 'cash' },
      key(),
    );
    expect((await asAdmin('POST', `/enrollments/${enrollment.id}/certificate`)).statusCode).toBe(
      201,
    );

    // With nothing billed there's nothing owed, so it isn't blocked; and switching the policy off lifts it.
    const unbilled = await completed(openCohortId);
    expect(
      (await asAdmin('POST', `/enrollments/${unbilled.enrollment.id}/certificate`)).statusCode,
    ).toBe(201);
    const current = institutionSchema.parse((await asAdmin('GET', '/institution')).json());
    await asAdmin(
      'PATCH',
      '/institution',
      { certificateRequiresPaidInFull: false },
      ifMatch(current.version),
    );
    const owing = await completed(openCohortId);
    await asBoleDesk('POST', '/invoices', { enrollmentId: owing.enrollment.id }, key());
    expect(
      (await asAdmin('POST', `/enrollments/${owing.enrollment.id}/certificate`)).statusCode,
    ).toBe(201);
  });

  it('is limited by department, and revoking is for admins', async () => {
    const own = await completed(openCohortId);
    expect(
      (await asBoleDesk('POST', `/enrollments/${own.enrollment.id}/certificate`)).statusCode,
    ).toBe(403);
    const cert = certificateSchema.parse(
      (await asCoordinator('POST', `/enrollments/${own.enrollment.id}/certificate`)).json(),
    );
    expect((await asBoleDesk('GET', `/certificates/${cert.id}`)).statusCode).toBe(200);

    const python = await openCohort(computer.id);
    const other = await completed(python.id);
    expect(
      (await asCoordinator('POST', `/enrollments/${other.enrollment.id}/certificate`)).statusCode,
    ).toBe(403);

    expect(
      (
        await asCoordinator(
          'POST',
          `/certificates/${cert.id}/revoke`,
          { reason: 'Issued in error' },
          ifMatch(cert.version),
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await asAdmin(
          'POST',
          `/certificates/${cert.id}/revoke`,
          { reason: 'x' },
          ifMatch(cert.version),
        )
      ).statusCode,
    ).toBe(400);
  });

  it('prints an A4 landscape certificate with a QR code that points at the verification page', async () => {
    const { enrollment } = await completed(openCohortId);
    const cert = certificateSchema.parse(
      (await asAdmin('POST', `/enrollments/${enrollment.id}/certificate`)).json(),
    );
    const res = await asAdmin('GET', `/certificates/${cert.id}/pdf`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const token = await tokenOf('certificates', cert.id);
    const page = lastHtml();
    for (const text of [
      'size: A4 landscape',
      'Certificate of Completion',
      cert.serial,
      'English A1',
      cert.studentName,
      '<svg',
      `${WEB}/verify/${token}`,
    ]) {
      expect(page).toContain(text);
    }
    expect(page).not.toContain('REVOKED');
  });

  it('lists certificates for a student, only those a branch may see', async () => {
    const mine = await completed(openCohortId);
    const cert = certificateSchema.parse(
      (await asAdmin('POST', `/enrollments/${mine.enrollment.id}/certificate`)).json(),
    );
    const list = certificateListResponseSchema.parse(
      (await asBoleDesk('GET', `/certificates?studentId=${mine.student.id}`)).json(),
    );
    expect(list.items.map((c) => c.id)).toEqual([cert.id]);
    const elsewhere = await createStaff(app, { email: 'docs-piassa2@lingua.test' });
    await grantRole(elsewhere, 'secretary', { type: 'branch', id: piassa.id });
    const theirs = certificateListResponseSchema.parse(
      (await callAs(app, elsewhere)('GET', `/certificates?studentId=${mine.student.id}`)).json(),
    );
    expect(theirs.items).toEqual([]);
    expect((await callAs(app, elsewhere)('GET', `/certificates/${cert.id}`)).statusCode).toBe(403);
  });

  it('is switched off with the module', async () => {
    const { enrollment } = await completed(openCohortId);
    await asAdmin('PUT', '/modules/certificates', { enabled: false });
    const res = await asAdmin('POST', `/enrollments/${enrollment.id}/certificate`);
    expect(res.statusCode).toBe(404);
    expect(code(res)).toBe('MODULE_DISABLED');
    await asAdmin('PUT', '/modules/certificates', { enabled: true });
  });

  it('keeps only ids, serials and numbers in the audit log, never names', async () => {
    const { student, enrollment } = await completed(openCohortId);
    const cert = certificateSchema.parse(
      (await asAdmin('POST', `/enrollments/${enrollment.id}/certificate`)).json(),
    );
    const audit = auditListResponseSchema.parse(
      (await asAdmin('GET', `/audit-log?action=certificate.issued&entityId=${cert.id}`)).json(),
    );
    const text = JSON.stringify(audit.items[0]?.changes);
    expect(text).toContain(cert.serial);
    expect(text).not.toContain(student.givenName);
  });
});

describe('verifying from the QR code', () => {
  const issue = async () => {
    const { enrollment } = await completed(openCohortId);
    const cert = certificateSchema.parse(
      (await asAdmin('POST', `/enrollments/${enrollment.id}/certificate`)).json(),
    );
    return { cert, token: await tokenOf('certificates', cert.id) };
  };
  const verify = (token: string) => callAs(app, null)('GET', `/verify/${token}`);

  it('confirms a real certificate to anyone, without signing in, and shows only what is printed on it', async () => {
    const { cert, token } = await issue();
    const res = await verify(token);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const result = verificationSchema.parse(res.json());
    expect(result).toMatchObject({
      kind: 'certificate',
      status: 'valid',
      holderName: cert.studentName,
      title: 'English A1',
      serial: cert.serial,
      issuedOn: cert.completedOn,
      revokedOn: null,
      institutionName: 'Lingua Institute',
    });
    // Nothing beyond the printed details: no student number, contact, or ids.
    expect(Object.keys(result).sort()).toEqual(
      [
        'holderName',
        'institutionName',
        'issuedOn',
        'kind',
        'revokedOn',
        'serial',
        'status',
        'title',
        'validUntil',
      ].sort(),
    );
  });

  it('says so when a certificate has been revoked, and a reissue verifies as new', async () => {
    const { cert, token } = await issue();
    const res = await asAdmin(
      'POST',
      `/certificates/${cert.id}/revoke`,
      { reason: 'Issued to the wrong student' },
      ifMatch(cert.version),
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(certificateSchema.parse(res.json())).toMatchObject({
      status: 'revoked',
      revokedReason: 'Issued to the wrong student',
    });
    expect(verificationSchema.parse((await verify(token)).json())).toMatchObject({
      status: 'revoked',
      revokedOn: todayAddis(),
    });

    const again = await asAdmin(
      'POST',
      `/certificates/${cert.id}/revoke`,
      { reason: 'Second time' },
      ifMatch(cert.version + 1),
    );
    expect(code(again)).toBe('ALREADY_REVOKED');

    // Revoke, then issue again: a new serial and token, the old one stays revoked.
    const reissued = certificateSchema.parse(
      (await asAdmin('POST', `/enrollments/${cert.enrollmentId}/certificate`)).json(),
    );
    expect(reissued.serial).not.toBe(cert.serial);
    const fresh = verificationSchema.parse(
      (await verify(await tokenOf('certificates', reissued.id))).json(),
    );
    expect(fresh.status).toBe('valid');
    expect(verificationSchema.parse((await verify(token)).json()).status).toBe('revoked');

    // A revoked certificate still prints, stamped.
    await asAdmin('GET', `/certificates/${cert.id}/pdf`);
    expect(lastHtml()).toContain('REVOKED');
  });

  it('answers a guess or a mangled code with a plain not-found, not detail', async () => {
    const unknown = await verify('A'.repeat(43));
    expect(unknown.statusCode).toBe(404);
    expect(code(unknown)).toBe('VERIFICATION_NOT_FOUND');
    expect((await verify('short')).statusCode).toBe(400);
    expect((await verify(`${'A'.repeat(20)}%27%20OR%201=1`)).statusCode).toBe(400);
  });

  it('cannot be altered in the database, and certificates cannot be deleted', async () => {
    const { cert } = await issue();
    await withDb(async (c) => {
      await expect(
        c.query("UPDATE certificates SET student_name = 'Someone Else' WHERE id = $1", [cert.id]),
      ).rejects.toThrow(/cannot be changed/);
      await expect(
        c.query("UPDATE certificates SET serial = 'CERT-FAKE' WHERE id = $1", [cert.id]),
      ).rejects.toThrow(/cannot be changed/);
      await expect(c.query('DELETE FROM certificates')).rejects.toThrow(/permission denied/);
    });
  });
});

describe('student ID cards', () => {
  it('issues a card valid for a year and prints it card-sized with a QR code', async () => {
    const student = await nextStudent();
    expect(
      studentCardSchema
        .nullable()
        .parse((await asBoleDesk('GET', `/students/${student.id}/id-card`)).json()),
    ).toBeNull();
    expect((await asBoleDesk('GET', `/students/${student.id}/id-card/pdf`)).statusCode).toBe(404);

    const res = await asBoleDesk('POST', `/students/${student.id}/id-card`);
    expect(res.statusCode, res.body).toBe(201);
    const card = studentCardSchema.parse(res.json());
    expect(card).toMatchObject({
      status: 'active',
      validFrom: todayAddis(),
      validUntil: plusDays(todayAddis(), 365),
    });

    const pdf = await asBoleDesk('GET', `/students/${student.id}/id-card/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const token = await tokenOf('student_cards', card.id);
    const page = lastHtml();
    for (const text of [
      'size: 85.6mm 54mm',
      student.studentNumber,
      student.givenName,
      'Valid until',
      '<svg',
      'Lingua Institute',
    ]) {
      expect(page).toContain(text);
    }
    expect(page).not.toContain(token); // the link isn't printed on the card, only encoded in the QR
    expect(
      verificationSchema.parse((await callAs(app, null)('GET', `/verify/${token}`)).json()),
    ).toMatchObject({
      kind: 'student_card',
      status: 'valid',
      title: 'Student ID',
      serial: student.studentNumber,
      validUntil: card.validUntil,
    });
  });

  it('revokes the old card when a new one is issued, so a lost card stops verifying', async () => {
    const student = await nextStudent();
    const first = studentCardSchema.parse(
      (await asBoleDesk('POST', `/students/${student.id}/id-card`)).json(),
    );
    const oldToken = await tokenOf('student_cards', first.id);
    const second = studentCardSchema.parse(
      (await asBoleDesk('POST', `/students/${student.id}/id-card`)).json(),
    );
    expect(second.id).not.toBe(first.id);
    expect(
      verificationSchema.parse((await callAs(app, null)('GET', `/verify/${oldToken}`)).json())
        .status,
    ).toBe('revoked');
    expect(
      verificationSchema.parse(
        (
          await callAs(app, null)('GET', `/verify/${await tokenOf('student_cards', second.id)}`)
        ).json(),
      ).status,
    ).toBe('valid');
    const current = studentCardSchema.parse(
      (await asBoleDesk('GET', `/students/${student.id}/id-card`)).json(),
    );
    expect(current.id).toBe(second.id);
  });

  it('is only for active students at the caller’s branch, and needs the module', async () => {
    const held = await nextStudent();
    await asBoleDesk(
      'PATCH',
      `/students/${held.id}`,
      { status: 'withdrawn' },
      ifMatch(held.version),
    );
    const res = await asBoleDesk('POST', `/students/${held.id}/id-card`);
    expect(res.statusCode).toBe(422);
    expect(code(res)).toBe('NOT_ELIGIBLE_FOR_CERTIFICATE');

    const elsewhere = await nextStudent({ branchId: piassa.id }, asAdmin);
    expect((await asBoleDesk('POST', `/students/${elsewhere.id}/id-card`)).statusCode).toBe(403);
    expect((await asBoleDesk('GET', `/students/${elsewhere.id}/id-card/pdf`)).statusCode).toBe(403);

    const ok = await nextStudent();
    await asAdmin('PUT', '/modules/student_ids', { enabled: false });
    expect(code(await asBoleDesk('POST', `/students/${ok.id}/id-card`))).toBe('MODULE_DISABLED');
    await asAdmin('PUT', '/modules/student_ids', { enabled: true });
  });

  it('cannot have its dates or token rewritten', async () => {
    const student = await nextStudent();
    const card = studentCardSchema.parse(
      (await asBoleDesk('POST', `/students/${student.id}/id-card`)).json(),
    );
    await withDb(async (c) => {
      await expect(
        c.query("UPDATE student_cards SET valid_until = '2099-01-01' WHERE id = $1", [card.id]),
      ).rejects.toThrow(/cannot be changed/);
      await expect(c.query('DELETE FROM student_cards')).rejects.toThrow(/permission denied/);
    });
  });
});

describe('fee reminders', () => {
  const reminders = () => app.get(FeeRemindersService);
  const runOn = (today: string) => app.get(ClsService).run(() => reminders().run({ today }));
  const emailsTo = async (address: string) =>
    (await mailApp.mail.sent()).filter((m) => m.to === address);

  /** An enrolled student with an invoice and a place to send email. Instalments fall due today, +30 and +60 days. */
  const billed = async (email: string | null, extra: Record<string, unknown> = {}) => {
    const cohortId = (await openCohort(course.id)).id;
    const { student, enrollment } = await enrolled(cohortId, { email, ...extra });
    const invoice = invoiceSchema.parse(
      (await asBoleDesk('POST', '/invoices', { enrollmentId: enrollment.id }, key())).json(),
    );
    return { student, invoice };
  };
  const today = todayAddis();

  it('waits a day for a new invoice, then reminds once per stage as the dates pass', async () => {
    const address = `stages-${randomUUID().slice(0, 6)}@lingua.test`;
    const { invoice } = await billed(address);

    await runOn(today);
    expect(await emailsTo(address)).toHaveLength(0); // billed today: the student is at the desk

    await runOn(plusDays(today, 1)); // instalment 1 fell due today
    expect((await emailsTo(address)).map((m) => m.subject)).toEqual([
      `Fee reminder: payment due today (${invoice.number})`,
    ]);
    await runOn(plusDays(today, 1));
    expect(await emailsTo(address)).toHaveLength(1); // same stage again: nothing

    await runOn(plusDays(today, 3));
    await runOn(plusDays(today, 7));
    await runOn(plusDays(today, 12)); // too late for anything new
    const subjects = (await emailsTo(address)).map((m) => m.subject);
    expect(subjects).toHaveLength(3);
    expect(subjects[1]).toContain('overdue');
    expect(subjects[2]).toContain('overdue');
    const last = (await emailsTo(address))[2]!;
    expect(last.text).toContain('instalment 1 of invoice');
    expect(last.text).toContain('ETB 750.00'); // 50% of 1,500.00
    expect(last.text).toContain('Lingua Institute');
  });

  it('warns three days before the next instalment falls due', async () => {
    const address = `soon-${randomUUID().slice(0, 6)}@lingua.test`;
    const { invoice } = await billed(address);
    // Instalment 1 is paid, so only #2 (due in 30 days) is left to remind about.
    await asBoleDesk(
      'POST',
      '/payments',
      { invoiceId: invoice.id, amount: 75_000, method: 'cash' },
      key(),
    );
    await runOn(plusDays(today, 1));
    expect(await emailsTo(address)).toHaveLength(0);
    await runOn(plusDays(today, 27));
    const mail = await emailsTo(address);
    expect(mail).toHaveLength(1);
    expect(mail[0]?.subject).toContain('due soon');
    expect(mail[0]?.text).toContain('instalment 2');
    expect(mail[0]?.text).toContain('ETB 450.00');
  });

  it('never sends the same reminder twice, even when many workers run at once', async () => {
    const address = `race-${randomUUID().slice(0, 6)}@lingua.test`;
    await billed(address);
    const counts = await Promise.all(Array.from({ length: 6 }, () => runOn(plusDays(today, 1))));
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1);
    expect(await emailsTo(address)).toHaveLength(1);
  });

  it('sends to the payer named on the record, and records when there is nobody to tell', async () => {
    const payerAddress = `payer-${randomUUID().slice(0, 6)}@lingua.test`;
    const { student } = await billed(`student-${randomUUID().slice(0, 6)}@lingua.test`);
    await asBoleDesk(
      'PUT',
      `/students/${student.id}/guardians`,
      {
        guardians: [
          {
            name: 'Bekele Tadesse',
            relationship: 'Father',
            phone: '0911000009',
            email: payerAddress,
            isPayer: true,
          },
        ],
      },
      ifMatch(
        studentSchema.parse((await asBoleDesk('GET', `/students/${student.id}`)).json()).version,
      ),
    );
    await runOn(plusDays(today, 1));
    const mail = await emailsTo(payerAddress);
    expect(mail).toHaveLength(1);
    expect(mail[0]?.text).toContain('Dear Bekele Tadesse');

    const { invoice } = await billed(null);
    await runOn(plusDays(today, 1));
    const logged = await withDb((c) =>
      c.query<{ outcome: string }>(
        `SELECT r.outcome FROM reminder_log r JOIN installments i ON i.id = r.installment_id WHERE i.invoice_id = $1`,
        [invoice.id],
      ),
    );
    expect(logged.rows.map((r) => r.outcome)).toEqual(['no_contact']);
  });

  it('leaves alone paid instalments, and does nothing while the feature is off', async () => {
    const address = `off-${randomUUID().slice(0, 6)}@lingua.test`;
    const { invoice } = await billed(address);
    await asAdmin('PUT', '/modules/fee_reminders', { enabled: false });
    expect(await runOn(plusDays(today, 1))).toBe(0);
    await asAdmin('PUT', '/modules/fee_reminders', { enabled: true });
    expect(await emailsTo(address)).toHaveLength(0);

    await asBoleDesk(
      'POST',
      '/payments',
      { invoiceId: invoice.id, amount: invoice.total, method: 'cash' },
      key(),
    );
    await runOn(plusDays(today, 1));
    await runOn(plusDays(today, 3));
    expect(await emailsTo(address)).toHaveLength(0);
  });

  it('cannot have its log rewritten or removed', async () => {
    await withDb(async (c) => {
      await expect(c.query("UPDATE reminder_log SET stage = 'due_today'")).rejects.toThrow(
        /permission denied/,
      );
      await expect(c.query('DELETE FROM reminder_log')).rejects.toThrow(/permission denied/);
    });
  });
});
