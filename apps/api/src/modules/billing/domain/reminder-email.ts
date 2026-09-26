import { formatMoney } from '@emis/contracts';

import type { ReminderStage } from './reminder-stages.js';

export interface ReminderEmailInput {
  stage: ReminderStage;
  recipientName: string;
  institutionName: string;
  invoiceNumber: string;
  instalment: number;
  owed: number;
  currency: string;
  dueDate: string;
}

const esc = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** The email for a fee reminder: a plain, polite line for each stage. */
export function reminderEmail(input: ReminderEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const amount = formatMoney(input.owed, input.currency);
  const item = `instalment ${input.instalment} of invoice ${input.invoiceNumber}`;
  const overdue = input.stage === 'overdue_3' || input.stage === 'overdue_7';

  const subject =
    input.stage === 'due_in_3'
      ? `Fee reminder: payment due soon (${input.invoiceNumber})`
      : input.stage === 'due_today'
        ? `Fee reminder: payment due today (${input.invoiceNumber})`
        : `Fee reminder: payment overdue (${input.invoiceNumber})`;

  const when =
    input.stage === 'due_in_3'
      ? `is due on ${input.dueDate}`
      : input.stage === 'due_today'
        ? 'is due today'
        : `was due on ${input.dueDate}`;

  const lines = [
    `Dear ${input.recipientName},`,
    '',
    `This is a reminder that ${item}, ${amount}, ${when}.`,
    overdue
      ? 'Please arrange payment as soon as you can, or contact us if you need to talk about it.'
      : 'You can pay at our front desk.',
    '',
    'If you have already paid, thank you, and please disregard this message.',
    '',
    input.institutionName,
  ];
  return {
    subject,
    text: lines.join('\n'),
    html: lines.map((line) => (line === '' ? '<br>' : `<p>${esc(line)}</p>`)).join(''),
  };
}
