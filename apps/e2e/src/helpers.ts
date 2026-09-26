import pg from 'pg';

import { E2E_DATABASE, inDatabase, MAILPIT_URL, required, URLS } from './config.js';
import { expect, type Session } from './fixtures.js';

/** Signs in through the portal's real sign-in form. */
export async function signIn({ page }: Session, email: string, password: string): Promise<void> {
  await page.goto(`${URLS.portal}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible();
}

/** The email Mailpit caught for this address, once the worker has delivered it. */
export async function emailTo(address: string): Promise<{ subject: string; text: string }> {
  const query = encodeURIComponent(`to:${address}`);
  let found: { subject: string; text: string } | undefined;
  await expect
    .poll(
      async () => {
        const list = (await (
          await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`)
        ).json()) as {
          messages: { ID: string; Subject: string }[];
        };
        const first = list.messages[0];
        if (!first) return null;
        const full = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${first.ID}`)).json()) as {
          Text: string;
        };
        found = { subject: first.Subject, text: full.Text };
        return first.Subject;
      },
      { timeout: 30_000, message: `no email reached ${address}` },
    )
    .not.toBeNull();
  return found as { subject: string; text: string };
}

/** The verification token printed in a certificate's QR code, straight from the database. */
export async function certificateToken(serialOrHolder: string): Promise<string> {
  const client = new pg.Client({
    connectionString: inDatabase(required('DATABASE_ADMIN_URL'), E2E_DATABASE),
  });
  await client.connect();
  try {
    const { rows } = await client.query<{ token: string }>(
      'SELECT token FROM certificates WHERE student_name ILIKE $1 ORDER BY created_at DESC LIMIT 1',
      [`%${serialOrHolder}%`],
    );
    const token = rows[0]?.token;
    if (!token) throw new Error(`No certificate found for ${serialOrHolder}`);
    return token;
  } finally {
    await client.end();
  }
}
