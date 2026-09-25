import { describe, expect, it } from 'vitest';

import { formatNumber } from './numbering.js';
import {
  completeSetupRequestSchema,
  DESCRIPTOR_NAMESPACES,
  defaultTerminology,
  descriptorCodeSchema,
  MODULES,
  NUMBER_SERIES,
  orgCodeSchema,
  updateInstitutionRequestSchema,
} from './settings.js';

describe('settings contracts', () => {
  it('normalizes codes', () => {
    expect(orgCodeSchema.parse(' bole ')).toBe('BOLE');
    expect(orgCodeSchema.safeParse('A').success).toBe(false);
    expect(orgCodeSchema.safeParse('BOLE-1').success).toBe(false);
  });

  it('turns empty optional text into null', () => {
    const parsed = updateInstitutionRequestSchema.parse({ tagline: '  ', email: '', website: '' });
    expect(parsed).toEqual({ tagline: null, email: null, website: null });
  });

  it('validates time zones, colours and the fiscal year start', () => {
    const ok = updateInstitutionRequestSchema.safeParse({
      timezone: 'Africa/Addis_Ababa',
      primaryColor: '#1D4ED8',
      fiscalYearStart: '07-08',
    });
    expect(ok.success && ok.data.primaryColor).toBe('#1d4ed8');
    expect(updateInstitutionRequestSchema.safeParse({ timezone: 'Mars/Base' }).success).toBe(false);
    expect(updateInstitutionRequestSchema.safeParse({ fiscalYearStart: '13-01' }).success).toBe(
      false,
    );
    expect(
      updateInstitutionRequestSchema.safeParse({ website: 'javascript:alert(1)' }).success,
    ).toBe(false);
  });

  it('only depends on modules that exist', () => {
    for (const mod of Object.values(MODULES))
      for (const dep of mod.requires) expect(Object.keys(MODULES)).toContain(dep);
  });

  it('ships valid default patterns and list values', () => {
    const ctx = { year: 2026, month: 1, fiscalYear: 2025, branchCode: 'MAIN' };
    for (const series of Object.values(NUMBER_SERIES))
      expect(formatNumber(series.defaultPattern, ctx, 1)).toMatch(/1$/);
    for (const ns of Object.values(DESCRIPTOR_NAMESPACES))
      for (const [code] of ns.defaults) expect(descriptorCodeSchema.parse(code)).toBe(code);
    expect(defaultTerminology().cohort).toEqual({ singular: 'Cohort', plural: 'Cohorts' });
  });

  it('needs at least one branch to finish setup', () => {
    const institution = {
      name: 'Test Institute',
      shortName: 'TI',
      country: 'ET',
      primaryColor: '#123456',
      locale: 'en',
      currency: 'ETB',
      timezone: 'Africa/Addis_Ababa',
      calendarDisplay: 'both',
      fiscalYearStart: '07-08',
    };
    expect(completeSetupRequestSchema.safeParse({ institution, branches: [] }).success).toBe(false);
    const parsed = completeSetupRequestSchema.parse({
      institution,
      branches: [{ code: 'main', name: 'Main campus' }],
    });
    expect(parsed.branches[0]?.code).toBe('MAIN');
    expect(parsed.seedDefaultLists).toBe(true);
  });
});
