import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { roles, userRoleAssignments } from '@emis/db';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';

import { AppModule } from '../app.module.js';
import { configureApp, createFastifyAdapter } from '../app.setup.js';
import { loadEnv } from '../config/env.js';
import type { DbAdapter } from '../database/database.module.js';
import { callAs, createStaff, TEST_PASSWORD } from './staff-fixtures.js';

/**
 * Sets up a fresh install for the end-to-end test: finished first-run setup, one course with an open
 * class and its fee, and three staff accounts. Run against the e2e database with the real environment
 * (`pnpm --filter @emis/e2e test` does this), printing what the test needs as one `E2E_SEED {json}` line.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(env), {
    bufferLogs: true,
  });
  await configureApp(app, env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const admin = await createStaff(app, { email: 'e2e-admin@lingua.test', roleKey: 'admin' });
  const secretary = await createStaff(app, { email: 'e2e-secretary@lingua.test' });
  const coordinator = await createStaff(app, {
    email: 'e2e-coordinator@lingua.test',
    roleKey: 'coordinator',
  });
  const asAdmin = callAs(app, admin);
  const key = () => ({ 'idempotency-key': randomUUID() });
  const post = async <T>(url: string, body: object): Promise<T> => {
    const res = await asAdmin('POST', url, body, key());
    if (res.statusCode >= 300) throw new Error(`${url} ${res.statusCode}: ${res.body}`);
    return res.json<T>();
  };
  const patch = async (url: string, body: object, version: number) => {
    const res = await asAdmin('PATCH', url, body, { 'if-match': `"${version}"` });
    if (res.statusCode >= 300) throw new Error(`${url} ${res.statusCode}: ${res.body}`);
  };

  const setup = await asAdmin(
    'POST',
    '/setup',
    {
      institution: {
        name: 'Lingua Computer and Language Institute',
        shortName: 'Lingua',
        tagline: 'Learn languages and technology, on your schedule.',
        country: 'ET',
        primaryColor: '#0f766e',
        locale: 'en',
        currency: 'ETB',
        timezone: 'Africa/Addis_Ababa',
        calendarDisplay: 'gregorian',
        fiscalYearStart: '07-08',
      },
      branches: [{ code: 'BOLE', name: 'Bole' }],
      presets: ['language'],
    },
    key(),
  );
  if (setup.statusCode !== 200) throw new Error(`setup ${setup.statusCode}: ${setup.body}`);

  const branches = (await asAdmin('GET', '/branches')).json<{ items: { id: string }[] }>();
  const departments = (await asAdmin('GET', '/departments')).json<{ items: { id: string }[] }>();
  const branchId = branches.items[0]?.id;
  const departmentId = departments.items[0]?.id;
  if (!branchId || !departmentId) throw new Error('setup created no branch or department');

  // The front desk works at one branch, as in real life.
  const db = app.get<TransactionHost<DbAdapter>>(TransactionHost);
  await app.get(ClsService).run(async () => {
    const [role] = await db.tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, 'secretary'));
    if (!role) throw new Error('secretary role missing');
    await db.tx.insert(userRoleAssignments).values({
      userId: secretary.userId,
      roleId: role.id,
      scopeType: 'branch',
      scopeId: branchId,
    });
  });

  const program = await post<{ id: string; version: number }>('/programs', {
    departmentId,
    code: 'ENG',
    name: 'General English',
    type: 'long_course',
    description: 'Levels from beginner to advanced.',
  });
  await patch(`/programs/${program.id}`, { isPublished: true }, program.version);
  const course = await post<{ id: string; name: string }>('/courses', {
    programId: program.id,
    code: 'A1',
    name: 'English A1 Beginner',
    durationWeeks: 12,
    totalHours: 96,
  });
  const shift = await post<{ id: string }>('/shifts', {
    code: 'EVE',
    name: 'Evening',
    daysOfWeek: [1, 3, 5],
    startTime: '17:30',
    endTime: '19:30',
  });
  const room = await post<{ id: string }>('/rooms', {
    branchId,
    code: 'R1',
    name: 'Room 1',
    type: 'classroom',
    capacity: 25,
  });
  const start = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 98 * 86_400_000).toISOString().slice(0, 10);
  const cohort = await post<{ id: string; version: number; name: string }>('/cohorts', {
    name: 'English A1 Evening',
    courseId: course.id,
    shiftId: shift.id,
    roomId: room.id,
    maxSize: 20,
    startDate: start,
    endDate: end,
  });
  const opened = await asAdmin(
    'POST',
    `/cohorts/${cohort.id}/status`,
    { status: 'open' },
    {
      'if-match': `"${cohort.version}"`,
    },
  );
  if (opened.statusCode !== 200) throw new Error(`open cohort: ${opened.body}`);

  await post('/fee-structures', {
    name: 'Standard fee',
    courseId: course.id,
    effectiveFrom: '2026-01-01',
    components: [{ name: 'Tuition', amount: 150_000 }],
  });
  await post('/payment-plans', {
    name: 'Three payments',
    isDefault: true,
    installments: [
      { shareBp: 5000, dueOffsetDays: 0 },
      { shareBp: 3000, dueOffsetDays: 30 },
      { shareBp: 2000, dueOffsetDays: 60 },
    ],
  });
  // The reason list a student withdrawal needs, so the front desk isn't blocked on it.
  await asAdmin(
    'POST',
    '/descriptors',
    { namespace: 'withdrawal_reason', code: 'other', label: 'Other' },
    key(),
  );

  const seed = {
    password: TEST_PASSWORD,
    adminCookie: admin.cookie,
    secretaryEmail: secretary.email,
    coordinatorEmail: coordinator.email,
    branchId,
    course: { id: course.id, name: course.name },
    cohort: { id: cohort.id, name: cohort.name },
  };
  process.stdout.write(`E2E_SEED ${JSON.stringify(seed)}\n`);
  await app.close();
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
