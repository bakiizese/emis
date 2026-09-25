import { randomUUID } from 'node:crypto';

import {
  auditListResponseSchema,
  branchListResponseSchema,
  branchSchema,
  type CompleteSetupRequest,
  customFieldDefinitionSchema,
  departmentListResponseSchema,
  departmentSchema,
  descriptorListResponseSchema,
  descriptorSchema,
  institutionSchema,
  moduleListResponseSchema,
  numberSeriesListResponseSchema,
  problemDetailsSchema,
  publicProfileSchema,
  setupStatusResponseSchema,
  staffUserSchema,
  terminologyResponseSchema,
} from '@emis/contracts';
import { branches } from '@emis/db';
import { createIsolatedDatabase, type TestDatabaseUrls } from '@emis/db/testing';
import { TransactionHost } from '@nestjs-cls/transactional';
import { Controller, Get } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { count } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { ClsService } from 'nestjs-cls';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { DbAdapter } from '../../database/database.module.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { callAs, createStaff, type StaffFixture } from '../../testing/staff-fixtures.js';
import { Public } from '../identity/index.js';
import { NumberingService, RequiresModule } from './index.js';

@Controller('probe-news')
class NewsProbeController {
  @Get()
  @Public()
  @RequiresModule('news')
  ping() {
    return { ok: true };
  }
}

// Own database: setup runs once per install, and module switches are global.
let urls: TestDatabaseUrls;
let app: NestFastifyApplication;
let admin: StaffFixture;
let asAdmin: ReturnType<typeof callAs>;
let anonymous: ReturnType<typeof callAs>;

const code = (res: LightMyRequestResponse) => problemDetailsSchema.parse(res.json()).code;
const key = () => ({ 'idempotency-key': randomUUID() });
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });

const setupRequest = (overrides: Partial<CompleteSetupRequest> = {}): CompleteSetupRequest => ({
  institution: {
    name: 'Test Language and Computer Institute',
    shortName: 'TLCI',
    country: 'ET',
    primaryColor: '#0F766E',
    locale: 'en',
    currency: 'ETB',
    timezone: 'Africa/Addis_Ababa',
    calendarDisplay: 'both',
    fiscalYearStart: '07-08',
    email: 'info@tlci.test',
  },
  branches: [{ code: 'bole', name: 'Bole campus' }],
  presets: ['language', 'computer'],
  departments: [{ code: 'MUSIC', name: 'Music' }],
  ...overrides,
});

async function branchByCode(code: string) {
  const list = branchListResponseSchema.parse((await asAdmin('GET', '/branches')).json());
  const branch = list.items.find((b) => b.code === code);
  if (!branch) throw new Error(`branch ${code} missing`);
  return branch;
}

async function departmentByCode(code: string) {
  const list = departmentListResponseSchema.parse((await asAdmin('GET', '/departments')).json());
  const department = list.items.find((d) => d.code === code);
  if (!department) throw new Error(`department ${code} missing`);
  return department;
}

beforeAll(async () => {
  urls = await createIsolatedDatabase(inject('database'), 'emis_settings_test');
  app = await createTestApp({
    env: { DATABASE_URL: urls.appUrl, RATE_LIMIT_MAX: '10000' },
    controllers: [NewsProbeController],
  });
  admin = await createStaff(app, { email: 'settings-admin@lingua.test', roleKey: 'admin' });
  asAdmin = callAs(app, admin);
  anonymous = callAs(app, null);
});
afterAll(() => app.close());

describe('first-run setup', () => {
  it('starts with defaults that anyone can read', async () => {
    const profile = publicProfileSchema.parse(
      (await anonymous('GET', '/institution/public')).json(),
    );
    expect(profile.setupCompleted).toBe(false);
    expect(profile.terminology.cohort).toEqual({ singular: 'Cohort', plural: 'Cohorts' });
    expect(Object.values(profile.modules).every(Boolean)).toBe(true);

    const status = setupStatusResponseSchema.parse((await asAdmin('GET', '/setup')).json());
    expect(status.completed).toBe(false);
    expect(status.presets.map((p) => p.key)).toEqual(
      expect.arrayContaining(['language', 'computer']),
    );
  });

  it('refuses an unknown preset and leaves nothing behind', async () => {
    const res = await asAdmin('POST', '/setup', setupRequest({ presets: ['astrology'] }), key());
    expect(res.statusCode).toBe(422);
    expect(code(res)).toBe('UNKNOWN_PRESET');
    const [row] = await app
      .get<TransactionHost<DbAdapter>>(TransactionHost)
      .tx.select({ n: count() })
      .from(branches);
    expect(row?.n).toBe(0);
  });

  it('needs an idempotency key', async () => {
    const res = await asAdmin('POST', '/setup', setupRequest());
    expect(res.statusCode).toBe(400);
  });

  it('sets up the institution, branches, departments and lists in one go', async () => {
    const res = await asAdmin('POST', '/setup', setupRequest(), key());
    expect(res.statusCode).toBe(200);
    expect(institutionSchema.parse(res.json())).toMatchObject({
      name: 'Test Language and Computer Institute',
      primaryColor: '#0f766e',
      calendarDisplay: 'both',
      setupCompleted: true,
    });

    const depts = departmentListResponseSchema.parse((await asAdmin('GET', '/departments')).json());
    expect(depts.items.map((d) => d.code).sort()).toEqual(['COMP', 'LANG', 'MUSIC']);
    const list = branchListResponseSchema.parse((await asAdmin('GET', '/branches')).json());
    expect(list.items.map((b) => b.code)).toEqual(['BOLE']);
    const sources = descriptorListResponseSchema.parse(
      (await asAdmin('GET', '/descriptors?namespace=lead_source')).json(),
    );
    expect(sources.items.map((d) => d.code)).toContain('walk_in');

    const audit = auditListResponseSchema.parse(
      (await asAdmin('GET', '/audit-log?action=setup.completed')).json(),
    );
    expect(audit.items[0]?.changes).toMatchObject({ branchesCreated: 1, departmentsCreated: 3 });
  });

  it('runs only once', async () => {
    const res = await asAdmin('POST', '/setup', setupRequest(), key());
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe('SETUP_ALREADY_COMPLETED');
    const profile = publicProfileSchema.parse(
      (await anonymous('GET', '/institution/public')).json(),
    );
    expect(profile).toMatchObject({ setupCompleted: true, shortName: 'TLCI' });
  });
});

describe('versioned updates', () => {
  it('needs If-Match, rejects a stale version and bumps the version', async () => {
    const current = institutionSchema.parse((await asAdmin('GET', '/institution')).json());

    const missing = await asAdmin('PATCH', '/institution', { tagline: 'Learn for life' });
    expect(missing.statusCode).toBe(428);
    expect(code(missing)).toBe('VERSION_REQUIRED');

    const stale = await asAdmin(
      'PATCH',
      '/institution',
      { tagline: 'Learn for life' },
      ifMatch(current.version - 1),
    );
    expect(stale.statusCode).toBe(412);
    expect(code(stale)).toBe('VERSION_CONFLICT');

    const ok = await asAdmin(
      'PATCH',
      '/institution',
      { tagline: 'Learn for life' },
      ifMatch(current.version),
    );
    expect(ok.statusCode).toBe(200);
    expect(institutionSchema.parse(ok.json())).toMatchObject({
      tagline: 'Learn for life',
      version: current.version + 1,
    });

    const audit = auditListResponseSchema.parse(
      (await asAdmin('GET', '/audit-log?action=institution.updated')).json(),
    );
    expect(audit.items[0]?.changes).toEqual({ tagline: { from: null, to: 'Learn for life' } });
  });
});

describe('branches and departments', () => {
  it('rejects duplicate codes, case-insensitively', async () => {
    const created = await asAdmin('POST', '/branches', { code: 'piaz', name: 'Piassa' }, key());
    expect(created.statusCode).toBe(201);
    expect(branchSchema.parse(created.json()).code).toBe('PIAZ');

    const dup = await asAdmin('POST', '/branches', { code: 'PIAZ', name: 'Again' }, key());
    expect(dup.statusCode).toBe(409);
    expect(code(dup)).toBe('CODE_TAKEN');
  });

  it('keeps at least one branch active', async () => {
    const bole = await branchByCode('BOLE');
    const off = await asAdmin(
      'PATCH',
      `/branches/${bole.id}`,
      { isActive: false },
      ifMatch(bole.version),
    );
    expect(off.statusCode).toBe(200);

    const piaz = await branchByCode('PIAZ');
    const last = await asAdmin(
      'PATCH',
      `/branches/${piaz.id}`,
      { isActive: false },
      ifMatch(piaz.version),
    );
    expect(last.statusCode).toBe(409);
    expect(code(last)).toBe('LAST_ACTIVE_BRANCH');
  });

  it('updates a department', async () => {
    const music = await departmentByCode('MUSIC');
    const res = await asAdmin(
      'PATCH',
      `/departments/${music.id}`,
      { name: 'Music and Arts', sortOrder: 99 },
      ifMatch(music.version),
    );
    expect(departmentSchema.parse(res.json())).toMatchObject({
      name: 'Music and Arts',
      sortOrder: 99,
      code: 'MUSIC',
    });
  });

  it('lets roles be granted at an active branch or department only', async () => {
    const lang = await departmentByCode('LANG');
    const bole = await branchByCode('BOLE'); // deactivated above
    const piaz = await branchByCode('PIAZ');
    const invite = (email: string, roleKey: string, scope: object) =>
      asAdmin(
        'POST',
        '/users/invitations',
        { email, displayName: 'Scoped Person', roleKey, scope },
        key(),
      );

    const coordinator = await invite('coord-lang@lingua.test', 'coordinator', {
      type: 'department',
      id: lang.id,
    });
    expect(coordinator.statusCode).toBe(201);
    expect(staffUserSchema.parse(coordinator.json()).roles[0]?.scope).toEqual({
      type: 'department',
      id: lang.id,
    });

    expect(
      (await invite('sec-piaz@lingua.test', 'secretary', { type: 'branch', id: piaz.id }))
        .statusCode,
    ).toBe(201);
    expect(
      code(await invite('sec-bole@lingua.test', 'secretary', { type: 'branch', id: bole.id })),
    ).toBe('SCOPE_NOT_AVAILABLE');
    // A department id is not a branch.
    expect(
      code(await invite('sec-mix@lingua.test', 'secretary', { type: 'branch', id: lang.id })),
    ).toBe('SCOPE_NOT_AVAILABLE');
  });
});

describe('modules', () => {
  const setModule = (key: string, enabled: boolean) =>
    asAdmin('PUT', `/modules/${key}`, { enabled });

  it('respects dependencies both ways', async () => {
    const blocked = await setModule('website', false);
    expect(blocked.statusCode).toBe(422);
    expect(code(blocked)).toBe('MODULE_DEPENDENCY');

    expect((await setModule('pre_registration', false)).statusCode).toBe(200);
    const res = await setModule('website', false);
    const states = moduleListResponseSchema.parse(res.json()).items;
    expect(states.find((m) => m.key === 'website')?.enabled).toBe(false);

    expect(code(await setModule('pre_registration', true))).toBe('MODULE_DEPENDENCY');
    expect((await setModule('website', true)).statusCode).toBe(200);
    expect((await setModule('pre_registration', true)).statusCode).toBe(200);
  });

  it('hides routes of a switched-off module', async () => {
    expect((await anonymous('GET', '/probe-news')).statusCode).toBe(200);
    await setModule('news', false);
    const off = await anonymous('GET', '/probe-news');
    expect(off.statusCode).toBe(404);
    expect(code(off)).toBe('MODULE_DISABLED');
    const profile = publicProfileSchema.parse(
      (await anonymous('GET', '/institution/public')).json(),
    );
    expect(profile.modules.news).toBe(false);
    await setModule('news', true);
    expect((await anonymous('GET', '/probe-news')).statusCode).toBe(200);
  });
});

describe('terminology', () => {
  it('renames words and resets the ones left out', async () => {
    const set = await asAdmin('PUT', '/terminology', {
      overrides: { cohort: { singular: 'Batch', plural: 'Batches' } },
    });
    expect(set.statusCode).toBe(200);
    const items = terminologyResponseSchema.parse(set.json()).items;
    expect(items.find((t) => t.key === 'cohort')).toMatchObject({
      singular: 'Batch',
      defaultSingular: 'Cohort',
    });
    const profile = publicProfileSchema.parse(
      (await anonymous('GET', '/institution/public')).json(),
    );
    expect(profile.terminology.cohort.plural).toBe('Batches');

    await asAdmin('PUT', '/terminology', { overrides: {} });
    const reset = publicProfileSchema.parse((await anonymous('GET', '/institution/public')).json());
    expect(reset.terminology.cohort.singular).toBe('Cohort');
  });
});

describe('dropdown lists and custom fields', () => {
  it('adds, relabels and retires list values', async () => {
    const created = await asAdmin(
      'POST',
      '/descriptors',
      { namespace: 'lead_source', code: 'Radio', label: 'Radio ad' },
      key(),
    );
    const value = descriptorSchema.parse(created.json());
    expect(value.code).toBe('radio');
    const dup = await asAdmin(
      'POST',
      '/descriptors',
      { namespace: 'lead_source', code: 'radio', label: 'Again' },
      key(),
    );
    expect(code(dup)).toBe('CODE_TAKEN');

    const updated = await asAdmin(
      'PATCH',
      `/descriptors/${value.id}`,
      { label: 'FM radio', isActive: false },
      ifMatch(value.version),
    );
    expect(descriptorSchema.parse(updated.json())).toMatchObject({
      label: 'FM radio',
      isActive: false,
      code: 'radio',
    });
  });

  it('defines custom fields and keeps choices only on list fields', async () => {
    const list = customFieldDefinitionSchema.parse(
      (
        await asAdmin(
          'POST',
          '/custom-fields',
          {
            entityType: 'student',
            key: 'tshirt_size',
            label: 'T-shirt size',
            fieldType: 'select',
            options: ['S', 'M', 'L'],
          },
          key(),
        )
      ).json(),
    );
    expect(list.options).toEqual(['S', 'M', 'L']);

    const text = customFieldDefinitionSchema.parse(
      (
        await asAdmin(
          'POST',
          '/custom-fields',
          { entityType: 'student', key: 'employer', label: 'Employer', fieldType: 'text' },
          key(),
        )
      ).json(),
    );
    const bad = await asAdmin(
      'PATCH',
      `/custom-fields/${text.id}`,
      { options: ['a', 'b'] },
      ifMatch(text.version),
    );
    expect(bad.statusCode).toBe(422);
    expect(code(bad)).toBe('INVALID_OPTIONS');
  });
});

describe('numbering', () => {
  const numbering = () => app.get(NumberingService);
  const txHost = () => app.get<TransactionHost<DbAdapter>>(TransactionHost);
  /** Issue a number in its own transaction, like a request that stores a receipt would. */
  const issue = (branchId: string, fail = false) =>
    app.get(ClsService).run(() =>
      txHost().withTransaction(async () => {
        const issued = await numbering().next('receipt', { branchId });
        if (fail) throw new Error('rolled back');
        return issued;
      }),
    );

  it('validates patterns and shows an example', async () => {
    const bad = await asAdmin('PUT', '/number-series/receipt', { pattern: 'RCP-{DAY}' });
    expect(bad.statusCode).toBe(400);
    const ok = await asAdmin('PUT', '/number-series/receipt', {
      pattern: 'R-{BRANCH}-{FY}-{SEQ:5}',
    });
    const receipt = numberSeriesListResponseSchema
      .parse(ok.json())
      .items.find((s) => s.key === 'receipt');
    expect(receipt?.example).toMatch(/^R-[A-Z0-9]+-\d{4}-00001$/);
  });

  it('never repeats or skips a number under concurrency', async () => {
    const piaz = await branchByCode('PIAZ');
    const issued = await Promise.all(Array.from({ length: 30 }, () => issue(piaz.id)));
    const sequences = issued.map((n) => n.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(new Set(issued.map((n) => n.number)).size).toBe(30);
    expect(issued.find((n) => n.sequence === 7)?.number).toMatch(/^R-PIAZ-\d{4}-00007$/);
  });

  it('gives the number back when the transaction rolls back', async () => {
    const piaz = await branchByCode('PIAZ');
    await expect(issue(piaz.id, true)).rejects.toThrow('rolled back');
    expect((await issue(piaz.id)).sequence).toBe(31);
  });

  it('counts each branch separately', async () => {
    const bole = await branchByCode('BOLE');
    expect((await issue(bole.id)).number).toMatch(/^R-BOLE-\d{4}-00001$/);
  });
});
