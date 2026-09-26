import { describe, expect, it } from 'vitest';

import { reminderEmail } from './reminder-email.js';

const base = {
  recipientName: 'Almaz',
  institutionName: 'Lingua Institute',
  invoiceNumber: 'INV-2026-000007',
  instalment: 2,
  owed: 135_000,
  currency: 'ETB',
  dueDate: '30 Sep 2026',
};

describe('reminderEmail', () => {
  it('reads differently before, on and after the due date', () => {
    const soon = reminderEmail({ ...base, stage: 'due_in_3' });
    expect(soon.subject).toContain('due soon');
    expect(soon.text).toContain('is due on 30 Sep 2026');

    const today = reminderEmail({ ...base, stage: 'due_today' });
    expect(today.subject).toContain('due today');
    expect(today.text).toContain('is due today');

    for (const stage of ['overdue_3', 'overdue_7'] as const) {
      const late = reminderEmail({ ...base, stage });
      expect(late.subject).toContain('overdue');
      expect(late.text).toContain('was due on 30 Sep 2026');
      expect(late.text).toContain('as soon as you can');
    }
  });

  it('names the invoice, instalment and amount, and signs off with the institution', () => {
    const { text } = reminderEmail({ ...base, stage: 'due_today' });
    expect(text).toContain('instalment 2 of invoice INV-2026-000007, ETB 1,350.00');
    expect(text.trimEnd().endsWith('Lingua Institute')).toBe(true);
    expect(text).toContain('If you have already paid');
  });

  it('escapes names in the HTML version', () => {
    const { html } = reminderEmail({ ...base, stage: 'due_today', recipientName: '<img src=x>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x&gt;');
  });
});
