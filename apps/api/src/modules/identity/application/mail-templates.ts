import type { OutgoingEmail } from '../../../mail/mailer.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function layout(
  appName: string,
  paragraphs: string[],
  action?: { label: string; url: string },
): string {
  const body = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
  const button = action
    ? `<p><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:10px 16px;background:#23285a;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(action.label)}</a></p>`
    : '';
  return `<div style="font-family:system-ui,sans-serif;max-width:520px;line-height:1.5;color:#1f2333">${body}${button}<p style="color:#6b7080;font-size:13px">${escapeHtml(appName)}</p></div>`;
}

export function passwordResetEmail(
  to: string,
  appName: string,
  url: string,
  minutes: number,
): OutgoingEmail {
  const lines = [
    'Someone asked to reset the password for this account.',
    `Use the link below within ${minutes} minutes. It works once.`,
    "If this wasn't you, ignore this email. Your password stays the same.",
  ];
  return {
    to,
    subject: `Reset your ${appName} password`,
    text: `${lines.join('\n\n')}\n\n${url}\n`,
    html: layout(appName, lines, { label: 'Reset password', url }),
  };
}

export function accountLockedEmail(to: string, appName: string, until: Date): OutgoingEmail {
  const lines = [
    'We temporarily locked sign-in to your account after several failed password attempts.',
    `You can try again after ${until.toUTCString()}.`,
    "If this wasn't you, reset your password and tell your administrator.",
  ];
  return {
    to,
    subject: `${appName}: sign-in temporarily locked`,
    text: lines.join('\n\n'),
    html: layout(appName, lines),
  };
}

export function passwordChangedEmail(to: string, appName: string): OutgoingEmail {
  const lines = [
    'The password for your account was just changed and other devices were signed out.',
    "If this wasn't you, contact your administrator right away.",
  ];
  return {
    to,
    subject: `${appName}: your password was changed`,
    text: lines.join('\n\n'),
    html: layout(appName, lines),
  };
}
