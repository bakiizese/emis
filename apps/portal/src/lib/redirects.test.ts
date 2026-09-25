import { describe, expect, it } from 'vitest';

import { pathForNextStep, safeNextPath } from './redirects';

describe('safeNextPath', () => {
  it.each([
    [null, '/'],
    ['', '/'],
    ['/students/42', '/students/42'],
    ['https://evil.example', '/'],
    ['//evil.example/path', '/'],
    ['/\\evil.example', '/'],
    ['javascript:alert(1)', '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe('pathForNextStep', () => {
  it('sends pending sessions to the right MFA screen and keeps the destination', () => {
    expect(pathForNextStep('mfa', '/students')).toBe('/login/verify?next=%2Fstudents');
    expect(pathForNextStep('mfa_enrollment', '/')).toBe('/login/setup-mfa');
    expect(pathForNextStep('none', '/students')).toBe('/students');
  });
});
