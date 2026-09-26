import { randomUUID } from 'node:crypto';

import {
  auditListResponseSchema,
  branchListResponseSchema,
  branchSchema,
  problemDetailsSchema,
  studentImportResultSchema,
  studentListResponseSchema,
  studentSchema,
} from '@emis/contracts';
import { rolePermissions, roles, userRoleAssignments } from '@emis/db';
import { createIsolatedDatabase, type TestDatabaseUrls } from '@emis/db/testing';
import type { Scope } from '@emis/permissions';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import { ClsService } from 'nestjs-cls';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { DbAdapter } from '../../database/database.module.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { callAs, createStaff, type StaffFixture } from '../../testing/staff-fixtures.js';

// Own database: student numbers count from 1 and custom fields are global.
let urls: TestDatabaseUrls;
let app: NestFastifyApplication;
let asAdmin: ReturnType<typeof callAs>;
let bole: { id: string };

const code = (res: LightMyRequestResponse) => problemDetailsSchema.parse(res.json()).code;
const key = () => ({ 'idempotency-key': randomUUID() });

const BOM = String.fromCharCode(0xfeff);
const HEADER = 'given_name,father_name,gender,phone,branch';
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

const preview = async (file: string, body: Record<string, unknown> = {}) => {
  const res = await asAdmin('POST', '/imports/students/preview', { csv: file, ...body });
  expect(res.statusCode, res.body).toBe(200);
  return studentImportResultSchema.parse(res.json());
};
const commit = async (file: string, body: Record<string, unknown> = {}, headers = key()) => {
  const res = await asAdmin('POST', '/imports/students', { csv: file, ...body }, headers);
  expect(res.statusCode, res.body).toBe(201);
  return studentImportResultSchema.parse(res.json());
};
const students = async (q = '') =>
  studentListResponseSchema.parse((await asAdmin('GET', `/students?limit=100&q=${q}`)).json())
    .items;

async function financeImporter(email: string, scope: Scope): Promise<StaffFixture> {
  const staff = await createStaff(app, { email });
  await app.get(ClsService).run(async () => {
    const db = app.get<TransactionHost<DbAdapter>>(TransactionHost).tx;
    const [role] = await db
      .insert(roles)
      .values({
        key: `importer_${randomUUID().slice(0, 8)}`,
        name: 'Importer',
        allowedScopes: ['global', 'branch'],
      })
      .returning({ id: roles.id });
    if (!role) throw new Error('role not created');
    await db.insert(rolePermissions).values(
      ['students.import', 'students.manage'].map((permission) => ({
        roleId: role.id,
        permission,
      })),
    );
    await db.insert(userRoleAssignments).values({
      userId: staff.userId,
      roleId: role.id,
      scopeType: scope.type,
      scopeId: scope.type === 'global' ? null : scope.id,
    });
  });
  return staff;
}

beforeAll(async () => {
  urls = await createIsolatedDatabase(inject('database'), 'emis_imports_test');
  app = await createTestApp({ env: { DATABASE_URL: urls.appUrl, RATE_LIMIT_MAX: '100000' } });
  asAdmin = callAs(
    app,
    await createStaff(app, { email: 'imp-admin@lingua.test', roleKey: 'admin' }),
  );
  bole = branchSchema.parse(
    (await asAdmin('POST', '/branches', { code: 'BOLE', name: 'Bole Campus' }, key())).json(),
  );
  await asAdmin('POST', '/branches', { code: 'PIAZ', name: 'Piassa' }, key());
  await asAdmin(
    'POST',
    '/descriptors',
    { namespace: 'student_category', code: 'regular', label: 'Regular' },
    key(),
  );
});

afterAll(async () => {
  await app?.close();
});

describe('the preview (dry run)', () => {
  const file = [
    'First Name,Fathers Name,Grandfather Name,Sex,DOB,Mobile,Email,Campus,Category,Guardian,Guardian Phone,Favourite colour',
    'Abebe,Kebede,Tesfaye,M,23/04/2001,0911 22 33 44,abebe@example.test,BOLE,regular,,,blue',
    'Selam,Tesfaye,,female,2005-06-01,0922334455,,Bole Campus,,Tesfaye Alemu,0933445566,red',
    'Dawit,Mekonnen,,male,,not-a-phone,,BOLE,,,,',
    'Hana,Girma,,other,,0944556677,,BOLE,,,,',
    'Meron,Alemu,,female,,0955667788,,NOWHERE,,,,',
    'Yonas,Bekele,,male,,0966778899,,BOLE,scholarships,,,',
    'Tigist,Haile,,female,,0977889900,,BOLE,,Someone,,',
  ].join('\r\n');

  it('says what an import would do, row by row, in the file’s own line numbers', async () => {
    const result = await preview(file);
    expect(result).toMatchObject({
      dryRun: true,
      totalRows: 7,
      imported: 2,
      skippedDuplicates: 0,
      skippedErrors: 5,
    });
    expect(result.ignoredColumns).toEqual(['Favourite colour']);
    expect(result.issues.map((i) => [i.row, i.field])).toEqual([
      [4, 'phone'],
      [5, 'gender'],
      [6, 'branch'],
      [7, 'category'],
      [8, 'guardian_phone'],
    ]);
    expect(result.issues.every((i) => i.kind === 'error')).toBe(true);
  });

  it('never repeats a person’s details back', async () => {
    const result = await preview(file);
    const text = JSON.stringify(result);
    for (const private_ of ['Dawit', 'Mekonnen', '0944556677', 'Hana', 'abebe@example.test']) {
      expect(text).not.toContain(private_);
    }
  });

  it('saves nothing and uses no student numbers', async () => {
    await preview(file);
    expect(await students()).toHaveLength(0);
  });

  it('is limited to people who may import', async () => {
    const desk = await createStaff(app, { email: 'imp-desk@lingua.test', roleKey: 'secretary' });
    const res = await callAs(app, desk)('POST', '/imports/students/preview', {
      csv: csv('A,B,male,0911000001,BOLE'),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('the import', () => {
  const file = [
    'given_name,father_name,grandfather_name,gender,date_of_birth,phone,email,address,city,branch,category,guardian_name,guardian_relationship,guardian_phone',
    'Abebe,Kebede,Tesfaye,M,23/04/2001,0911 22 33 44,Abebe@Example.test,Bole,Addis Ababa,BOLE,regular,,,',
    'አበበ,ከበደ,,ወንድ-ለውጥ,,0922334455,,,,BOLE,,,,',
    'Selam,Tesfaye,,female,2005-06-01,0933445566,,,,Bole Campus,,Tesfaye Alemu,Father,0944556677',
  ].join('\r\n');

  it('adds the good rows, skips and reports the bad ones', async () => {
    const result = await commit(file);
    expect(result).toMatchObject({ dryRun: false, totalRows: 3, imported: 2, skippedErrors: 1 });
    expect(result.issues).toEqual([
      {
        row: 3,
        kind: 'error',
        field: 'gender',
        message: 'Use male or female (m or f also work).',
      },
    ]);

    const abebe = (await students('Abebe'))[0];
    expect(abebe?.studentNumber).toBe('STU-2026-00001');
    const full = studentSchema.parse((await asAdmin('GET', `/students/${abebe?.id}`)).json());
    expect(full).toMatchObject({
      givenName: 'Abebe',
      grandfatherName: 'Tesfaye',
      gender: 'male',
      dateOfBirth: '2001-04-23',
      phone: '+251911223344',
      email: 'abebe@example.test',
      city: 'Addis Ababa',
      categoryCode: 'regular',
      branchId: bole.id,
      status: 'active',
    });

    const selam = studentSchema.parse(
      (await asAdmin('GET', `/students/${(await students('Selam'))[0]?.id}`)).json(),
    );
    expect(selam.guardians).toHaveLength(1);
    expect(selam.guardians[0]).toMatchObject({
      name: 'Tesfaye Alemu',
      relationship: 'Father',
      phone: '+251944556677',
      isPrimary: true,
      isPayer: true,
    });
  });

  it('numbers students without gaps, as a preview gives its numbers back', async () => {
    await preview(csv('Pre,View,male,0911000010,BOLE', 'Pre2,View,male,0911000011,BOLE'));
    await commit(csv('Real,One,male,0911000012,BOLE', 'Real,Two,female,0911000013,BOLE'));
    const numbers = (await students('Real')).map((s) => s.studentNumber).sort();
    expect(numbers).toEqual(['STU-2026-00003', 'STU-2026-00004']);
  });

  it('reads Excel’s output: byte-order mark, CRLF, quoted commas, Amharic', async () => {
    const result = await commit(
      `${BOM}${HEADER}\r\n"Kebede, Jr.",Abera,male,0911000020,BOLE\r\nሰላም,አበበ,female,0911000021,BOLE\r\n`,
    );
    expect(result.imported).toBe(2);
    expect((await students('Kebede'))[0]?.givenName).toBe('Kebede, Jr.');
    expect((await students('ሰላም'))[0]?.fatherName).toBe('አበበ');
  });

  it('records what happened in the audit log, without anyone’s details', async () => {
    const res = await asAdmin('GET', '/audit-log?limit=100');
    const entry = auditListResponseSchema
      .parse(res.json())
      .items.find(
        (e) => e.action === 'students.imported' && (e.changes as { rows?: number }).rows === 3,
      );
    expect(entry?.changes).toMatchObject({ rows: 3, imported: 2, skippedErrors: 1 });
    expect(res.body).not.toContain('Tesfaye Alemu');
  });
});

describe('running it twice', () => {
  const file = csv('Twice,Imported,male,0911000030,BOLE', 'Also,Twice,female,0911000031,BOLE');

  it('replays a retry with the same key: same answer, students added once', async () => {
    const headers = key();
    const first = await asAdmin('POST', '/imports/students', { csv: file }, headers);
    const second = await asAdmin('POST', '/imports/students', { csv: file }, headers);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(await students('Twice')).toHaveLength(2);
  });

  it('skips everyone as a duplicate when the same file is sent again under a new key', async () => {
    const again = await commit(file);
    expect(again).toMatchObject({ imported: 0, skippedDuplicates: 2, skippedErrors: 0 });
    expect(
      again.issues.every((i) => i.kind === 'duplicate' && /STU-\d{4}-\d{5}/.test(i.message)),
    ).toBe(true);
    expect(await students('Twice')).toHaveLength(2);
  });

  it('adds likely duplicates only when asked to', async () => {
    const forced = await commit(file, { onDuplicate: 'import' });
    expect(forced).toMatchObject({ imported: 2, skippedDuplicates: 0 });
    expect(await students('Twice')).toHaveLength(4);
  });
});

describe('duplicates', () => {
  it('flags someone already on the books by phone, and says who without naming them', async () => {
    const result = await preview(csv('Fresh,Face,male,0911 000 030,BOLE'));
    expect(result).toMatchObject({ imported: 0, skippedDuplicates: 1 });
    expect(result.issues[0]?.message).toMatch(/Looks like STU-\d{4}-\d{5} \(same phone/);
    expect(JSON.stringify(result)).not.toContain('Twice');
  });

  it('spots the same person twice in one file', async () => {
    const result = await commit(
      csv('Solo,Person,female,0911000040,BOLE', 'Solo,Person,female,0911000040,BOLE'),
    );
    expect(result).toMatchObject({ imported: 1, skippedDuplicates: 1 });
    expect(result.issues[0]).toMatchObject({ row: 3, kind: 'duplicate' });
  });

  it('never adds the same people twice when many imports of one file arrive at once', async () => {
    const given = [
      'Aster',
      'Biruk',
      'Chala',
      'Dagim',
      'Eyob',
      'Fikre',
      'Genet',
      'Habtamu',
      'Iman',
      'Jemal',
      'Kidist',
      'Lemma',
      'Mulu',
      'Nardos',
      'Orion',
    ];
    const family = [
      'Zewdu',
      'Yilma',
      'Worku',
      'Vasco',
      'Ujulu',
      'Tadesse',
      'Sisay',
      'Regassa',
      'Qanaa',
      'Petros',
      'Onyango',
      'Negash',
      'Mamo',
      'Lakew',
      'Kassa',
    ];
    const rows = given.map(
      (name, n) => `${name}Crowd,${family[n]},male,09115000${String(n).padStart(2, '0')},BOLE`,
    );
    const file = csv(...rows);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => asAdmin('POST', '/imports/students', { csv: file }, key())),
    );
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    const imported = results.map((r) => studentImportResultSchema.parse(r.json()).imported);
    expect(imported.reduce((a, b) => a + b, 0)).toBe(15);
    expect(await students('Crowd')).toHaveLength(15);
  });
});

describe('a bad file', () => {
  const refuse = async (body: Record<string, unknown>, expected: string) => {
    for (const path of ['/imports/students/preview', '/imports/students']) {
      const res = await asAdmin('POST', path, body, key());
      expect(res.statusCode, `${path}: ${res.body}`).toBe(422);
      expect(code(res)).toBe(expected);
    }
  };

  it('needs at least one student under the header', async () => {
    await refuse({ csv: HEADER }, 'INVALID_IMPORT_FILE');
    await refuse({ csv: '\n\n' }, 'INVALID_IMPORT_FILE');
  });

  it('names the columns it cannot find', async () => {
    const res = await asAdmin('POST', '/imports/students/preview', {
      csv: 'given_name,phone\nA,0911',
    });
    expect(res.statusCode).toBe(422);
    expect(code(res)).toBe('MISSING_COLUMNS');
    expect(problemDetailsSchema.parse(res.json()).detail).toContain('father_name, gender, branch');
  });

  it('points at the line where a quote is never closed', async () => {
    const res = await asAdmin('POST', '/imports/students/preview', {
      csv: `${HEADER}\nA,"B,male,0911,BOLE`,
    });
    expect(res.statusCode).toBe(422);
    expect(problemDetailsSchema.parse(res.json()).detail).toContain('Line 2');
  });

  it('refuses more rows than one import may hold', async () => {
    const rows = Array.from({ length: 2001 }, (_, n) => `A${n},B,male,0911,BOLE`);
    await refuse({ csv: csv(...rows) }, 'TOO_MANY_ROWS');
  });

  it('refuses a request that is not a CSV string', async () => {
    for (const body of [
      {},
      { csv: '' },
      { csv: 5 },
      { csv: 'x'.repeat(900_001) },
      { csv: 'a', onDuplicate: 'maybe' },
    ]) {
      expect((await asAdmin('POST', '/imports/students/preview', body)).statusCode).toBe(400);
    }
  });
});

describe('limits', () => {
  it('only lets an importer add students to branches their grant covers', async () => {
    const branches = branchListResponseSchema.parse((await asAdmin('GET', '/branches')).json());
    const piassa = branches.items.find((b) => b.code === 'PIAZ');
    if (!piassa) throw new Error('no Piassa branch');
    const limited = callAs(
      app,
      await financeImporter('imp-piassa@lingua.test', { type: 'branch', id: piassa.id }),
    );
    const res = await limited(
      'POST',
      '/imports/students',
      { csv: csv('Local,Only,male,0911000050,PIAZ', 'Far,Away,male,0911000051,BOLE') },
      key(),
    );
    const result = studentImportResultSchema.parse(res.json());
    expect(result).toMatchObject({ imported: 1, skippedErrors: 1 });
    expect(result.issues[0]).toMatchObject({
      row: 3,
      field: 'branch',
      message: "You can't add students to this branch.",
    });
    expect(await students('Far')).toHaveLength(0);
    expect(await students('Local')).toHaveLength(1);
  });
});

describe('required custom fields', () => {
  it('stop an import cleanly instead of failing on every row halfway', async () => {
    const made = await asAdmin(
      'POST',
      '/custom-fields',
      {
        entityType: 'student',
        key: 'national_id',
        fieldType: 'text',
        label: 'National ID',
        required: true,
      },
      key(),
    );
    expect(made.statusCode, made.body).toBe(201);

    const result = await preview(csv('Needs,Field,male,0911000060,BOLE'));
    expect(result).toMatchObject({ imported: 0, skippedErrors: 1 });
    expect(result.issues[0]?.message).toContain('required custom fields');
    expect(await students('Needs')).toHaveLength(0);
  });
});
