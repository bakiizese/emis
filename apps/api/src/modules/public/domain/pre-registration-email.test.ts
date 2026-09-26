import { describe, expect, it } from 'vitest';

import { preRegistrationEmail } from './pre-registration-email.js';

const base = {
  applicantName: 'Abebe',
  institutionName: 'Lingua',
  reference: 'APP-000001',
  courseName: 'English A1',
};

describe('preRegistrationEmail', () => {
  it('gives the reference and the course', () => {
    const email = preRegistrationEmail(base);
    expect(email.subject).toContain('APP-000001');
    expect(email.text).toContain('English A1');
    expect(email.text).toContain('APP-000001');
  });

  it('escapes what the applicant typed in the HTML part', () => {
    const email = preRegistrationEmail({ ...base, applicantName: '<img src=x onerror=alert(1)>' });
    expect(email.html).not.toContain('<img');
    expect(email.html).toContain('&lt;img');
  });
});
