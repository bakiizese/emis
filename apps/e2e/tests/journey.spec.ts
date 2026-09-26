import { randomInt } from 'node:crypto';

import { URLS } from '../src/config.js';
import { expect, seedData, test } from '../src/fixtures.js';
import { certificateToken, emailTo, signIn } from '../src/helpers.js';

/**
 * The whole point of the system, in one story: someone applies on the website, the front desk
 * enrols them and takes their money, a coordinator completes them, and anyone can check their
 * certificate from the QR code. Each step is a test that builds on the one before it.
 */
test.describe.configure({ mode: 'serial' });

const seed = seedData();
const runId = Date.now().toString(36);
const applicant = {
  givenName: 'Selam',
  fatherName: `Tesfaye${runId}`,
  phone: `09${randomInt(10_000_000, 99_999_999)}`,
  email: `selam.${runId}@example.test`,
};
const fullName = `${applicant.givenName} ${applicant.fatherName}`;
let reference = '';
let studentUrl = '';
let receiptNumber = '';

test('a visitor finds a course and pre-registers on the website', async ({ session }) => {
  const { page } = await session();
  await page.goto(URLS.web);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Lingua');

  await page.getByRole('link', { name: 'Browse courses' }).click();
  await page.getByRole('link', { name: new RegExp(seed.course.name) }).click();
  await expect(page.getByRole('heading', { level: 1, name: seed.course.name })).toBeVisible();
  await expect(page.getByText(/\d+ seats left/)).toBeVisible();

  await page.getByRole('link', { name: 'Pre-register for this class' }).click();
  await page.getByLabel('First name').fill(applicant.givenName);
  await page.getByLabel("Father's name", { exact: true }).fill(applicant.fatherName);
  await page.getByLabel('Gender').selectOption('female');
  await page.getByLabel('Phone', { exact: true }).fill(applicant.phone);
  await page.getByLabel('Email', { exact: true }).fill(applicant.email);
  await page.getByLabel('You may contact me about this request').check();
  await page.getByRole('button', { name: 'Send my request' }).click();

  await expect(page.getByText('Thank you, we have your request.')).toBeVisible();
  reference = (await page.locator('strong.font-mono').textContent()) ?? '';
  expect(reference).toMatch(/^APP-/);

  const email = await emailTo(applicant.email);
  expect(email.subject).toContain(reference);
  expect(email.text).toContain(seed.course.name);
});

test('the front desk registers them, enrols them, takes a payment and prints the receipt', async ({
  session,
}) => {
  const desk = await session();
  const { page } = desk;
  await signIn(desk, seed.secretaryEmail, seed.password);

  // The application is waiting in the admissions queue.
  await page.goto(`${URLS.portal}/admissions`);
  await page.getByLabel('Search applications').fill(reference);
  await expect(page.getByText(reference)).toBeVisible();
  await page.getByRole('link', { name: new RegExp(applicant.fatherName) }).click();
  await expect(page.getByText(fullName).first()).toBeVisible();

  await page.getByRole('button', { name: 'Make an offer' }).click();
  await page.getByRole('button', { name: 'Register student' }).click();
  await page.getByRole('link', { name: 'Open the student record' }).click();
  await page.waitForURL(/\/students\/[0-9a-f-]{36}/);
  studentUrl = page.url();
  await expect(page.getByText(fullName).first()).toBeVisible();

  // Enrol them in the open class.
  await page.goto(`${URLS.portal}/cohorts/${seed.cohort.id}`);
  await page.getByLabel('Find a student to enroll').fill(applicant.fatherName);
  await page.getByRole('button', { name: 'Enroll', exact: true }).click();
  await expect(page.getByText(fullName).first()).toBeVisible();

  // Bill them and take the first payment.
  await page.goto(studentUrl);
  await page.getByRole('button', { name: 'Create invoice' }).click();
  await page.getByRole('link', { name: /INV-/ }).click();
  await page.waitForURL(/\/billing\/invoices\/[0-9a-f-]{36}/);
  await page.getByRole('button', { name: 'Record a payment' }).click();
  await page.getByLabel('Amount received').fill('750');
  await page.getByRole('button', { name: 'Record payment and issue receipt' }).click();
  await expect(page.getByText(/Recorded .*750.*Receipt RCP-/)).toBeVisible();

  await page.getByRole('link', { name: 'Receipt', exact: true }).click();
  await page.waitForURL(/\/billing\/receipts\/([0-9a-f-]{36})/);
  const paymentId = /\/billing\/receipts\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  receiptNumber =
    (
      await page
        .getByText(/RCP-[A-Z0-9-]+/)
        .first()
        .textContent()
    )?.match(/RCP-[A-Z0-9-]+/)?.[0] ?? '';
  expect(receiptNumber).toMatch(/^RCP-/);

  // The printable receipt really is a PDF.
  const pdf = await page.request.get(
    `${URLS.portal}/api/v1/payments/${paymentId}/receipt?format=a5`,
  );
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
});

test('a coordinator records the result and issues the certificate', async ({ session }) => {
  const coordinator = await session();
  const { page } = coordinator;
  await signIn(coordinator, seed.coordinatorEmail, seed.password);

  await page.goto(`${URLS.portal}/cohorts/${seed.cohort.id}`);
  await page.getByRole('button', { name: 'Record result' }).click();
  await page.getByRole('button', { name: 'Save result' }).click();

  await page.goto(studentUrl);
  await page.getByRole('button', { name: 'Issue certificate' }).click();
  await expect(page.getByText('Valid', { exact: true })).toBeVisible();
});

test('anyone can check the certificate from its QR link, until an admin revokes it', async ({
  session,
}) => {
  const token = await certificateToken(applicant.fatherName);

  const visitor = await session();
  await visitor.page.goto(`${URLS.web}/verify/${token}`);
  await expect(visitor.page.getByText('Genuine', { exact: true })).toBeVisible();
  await expect(visitor.page.getByRole('heading', { name: fullName })).toBeVisible();
  await expect(visitor.page.getByText(seed.course.name)).toBeVisible();

  const [name, value] = seed.adminCookie.split('=') as [string, string];
  const admin = await session({ name, value });
  await admin.page.goto(studentUrl);
  await admin.page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await admin.page.getByLabel('Why is it being revoked?').fill('Issued by mistake');
  await admin.page.getByRole('button', { name: 'Revoke certificate' }).click();
  await expect(admin.page.getByText('Revoked', { exact: true })).toBeVisible();

  await visitor.page.reload();
  await expect(visitor.page.getByText('Revoked', { exact: true })).toBeVisible();
  await expect(visitor.page.getByText('Genuine')).toHaveCount(0);
});
