import type { OutgoingEmail } from '../../../mail/mailer.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function invitationEmail(input: {
  to: string;
  displayName: string;
  inviterName: string;
  roleName: string;
  appName: string;
  url: string;
  hours: number;
}): OutgoingEmail {
  const lines = [
    `Hi ${input.displayName},`,
    `${input.inviterName} invited you to ${input.appName} as ${input.roleName}.`,
    `Use the link below within ${input.hours} hours to choose your password. It works once.`,
  ];
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;line-height:1.5;color:#1f2333">${lines
    .map((l) => `<p>${escapeHtml(l)}</p>`)
    .join(
      '',
    )}<p><a href="${escapeHtml(input.url)}" style="display:inline-block;padding:10px 16px;background:#23285a;color:#fff;border-radius:6px;text-decoration:none">Set up your account</a></p><p style="color:#6b7080;font-size:13px">${escapeHtml(input.appName)}</p></div>`;
  return {
    to: input.to,
    subject: `You're invited to ${input.appName}`,
    text: `${lines.join('\n\n')}\n\n${input.url}\n`,
    html,
  };
}
