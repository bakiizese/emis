import { describe, expect, it } from 'vitest';

import { raw } from './html.js';
import {
  certificate,
  type Letterhead,
  type ReceiptData,
  receiptA5,
  receiptThermal,
  studentCard,
} from './templates.js';

const letterhead: Letterhead = {
  name: 'Lingua Computer & Language Institute',
  address: 'Bole, Addis Ababa',
  phone: '+251 911 000000',
  color: '#0f766e',
};
const qr = raw('<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');
const hostile = '<script>alert(1)</script><img src="http://169.254.169.254/">';

const receipt: ReceiptData = {
  letterhead,
  receiptNumber: 'RCP-BOLE-2026-000042',
  date: '12 Sep 2026, 10:30',
  studentName: 'Hana Bekele',
  invoiceNumber: 'INV-2026-000007',
  method: 'bank transfer',
  reference: 'CBE-99812',
  amountText: 'ETB 1,500.50',
  allocations: [
    { label: 'Instalment 1', amountText: 'ETB 1,000.00' },
    { label: 'Instalment 2', amountText: 'ETB 500.50' },
  ],
  status: 'posted',
  voidedOn: null,
};

/** Nothing a template emits may make the browser fetch something. */
function expectNoExternalRequests(page: string) {
  expect(page).not.toMatch(/(src|href)\s*=\s*["']?https?:/i);
  expect(page).not.toMatch(/url\(\s*["']?https?:/i);
  expect(page).not.toMatch(/@import|<link|<script|<iframe|<object|<embed/i);
}

describe('receipts', () => {
  it.each([
    ['A5', receiptA5],
    ['thermal', receiptThermal],
  ])('%s shows the essentials', (_name, render) => {
    const page = render(receipt);
    for (const text of [
      'RCP-BOLE-2026-000042',
      'Hana Bekele',
      'INV-2026-000007',
      'ETB 1,500.50',
      'CBE-99812',
      'Instalment 2',
    ]) {
      expect(page).toContain(text);
    }
    expect(page).not.toContain('VOID');
    expectNoExternalRequests(page);
  });

  it('asks for the right paper', () => {
    expect(receiptA5(receipt)).toContain('size: A5');
    expect(receiptThermal(receipt)).toContain('size: 80mm 190mm');
  });

  it('marks a voided receipt as not valid', () => {
    const voided = { ...receipt, status: 'void' as const, voidedOn: '13 Sep 2026' };
    expect(receiptA5(voided)).toContain('VOID');
    expect(receiptA5(voided)).toContain('no longer valid proof of payment');
    expect(receiptThermal(voided)).toContain('NOT VALID - VOIDED');
  });

  it('cannot be hijacked by a hostile name or reference', () => {
    const page = receiptA5({ ...receipt, studentName: hostile, reference: hostile });
    expect(page).not.toContain('<script>');
    expect(page).toContain('&lt;script&gt;');
    expectNoExternalRequests(page);
    expectNoExternalRequests(receiptThermal({ ...receipt, studentName: hostile }));
  });
});

describe('student card', () => {
  const card = {
    letterhead,
    studentName: 'Hana Bekele Tadesse',
    studentNumber: 'STU-2026-00001',
    validUntil: '12 Sep 2027',
    status: 'active' as const,
    qr,
    verifyUrl: 'https://example.test/verify/abc',
  };

  it('is card-sized with the number, the validity and the QR', () => {
    const page = studentCard(card);
    expect(page).toContain('size: 85.6mm 54mm');
    for (const text of [
      'Hana Bekele Tadesse',
      'STU-2026-00001',
      'Valid until 12 Sep 2027',
      '<svg viewBox',
    ]) {
      expect(page).toContain(text);
    }
    expect(page).toContain('>HB<');
    expect(page).not.toContain('REVOKED');
    expectNoExternalRequests(page);
  });

  it('stamps a revoked or expired card, and survives a hostile name', () => {
    expect(studentCard({ ...card, status: 'revoked' })).toContain('REVOKED');
    expect(studentCard({ ...card, status: 'expired' })).toContain('EXPIRED');
    const page = studentCard({ ...card, studentName: hostile });
    expect(page).not.toContain('<script>');
    expectNoExternalRequests(page);
  });
});

describe('certificate', () => {
  const cert = {
    letterhead,
    studentName: 'Hana Bekele Tadesse',
    courseName: 'English A2',
    completedOn: '11 Dec 2026',
    serial: 'CERT-2026-00001',
    status: 'issued' as const,
    qr,
    verifyUrl: 'https://example.test/verify/abc',
  };

  it('is A4 landscape and carries the serial, the course and how to verify', () => {
    const page = certificate(cert);
    expect(page).toContain('size: A4 landscape');
    for (const text of [
      'Certificate of Completion',
      'Hana Bekele Tadesse',
      'English A2',
      '11 Dec 2026',
      'CERT-2026-00001',
      'https://example.test/verify/abc',
    ]) {
      expect(page).toContain(text);
    }
    expect(page).not.toContain('REVOKED');
    expectNoExternalRequests(page);
  });

  it('shows a revoked certificate as revoked and cannot be hijacked by a course name', () => {
    expect(certificate({ ...cert, status: 'revoked' })).toContain('REVOKED');
    const page = certificate({ ...cert, courseName: hostile, studentName: hostile });
    expect(page).not.toContain('<script>');
    expectNoExternalRequests(page);
  });

  it('can carry Amharic text', () => {
    expect(certificate({ ...cert, studentName: 'ሃና በቀለ' })).toContain('ሃና በቀለ');
  });
});
