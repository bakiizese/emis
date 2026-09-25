import { describe, expect, it } from 'vitest';

import { raw } from '../domain/html.js';
import { qrSvg } from '../domain/qr.js';
import {
  certificate,
  type Letterhead,
  type ReceiptData,
  receiptA5,
  receiptThermal,
  studentCard,
} from '../domain/templates.js';
import { GotenbergRenderer } from './pdf-renderer.js';

/**
 * Renders every template through a real Gotenberg and checks the PDF that comes back: exactly one
 * page, at the right paper size. Skipped unless a Gotenberg is named, so CI doesn't need one:
 *
 *   GOTENBERG_SMOKE_URL=http://localhost:3100 pnpm --filter @emis/api test
 */
const url = process.env.GOTENBERG_SMOKE_URL;
const MM = 72 / 25.4;

const letterhead: Letterhead = {
  name: 'Lingua Computer & Language Institute · ሊንጓ የኮምፒውተር እና ቋንቋ ተቋም',
  address: 'Bole, Addis Ababa',
  phone: '+251 911 000000',
  color: '#0f766e',
};

const receipt: ReceiptData = {
  letterhead,
  receiptNumber: 'RCP-BOLE-2026-000042',
  date: '12 Sept 2026, 10:30',
  studentName: 'ሃና በቀለ ታደሰ (Hana Bekele Tadesse)',
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

const pageCount = (pdf: Buffer) =>
  (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
function mediaBox(pdf: Buffer): [number, number] {
  const match = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString('latin1'));
  return [Number(match?.[1]), Number(match?.[2])];
}

describe.skipIf(!url)('templates through a real Gotenberg', () => {
  const renderer = new GotenbergRenderer(url ?? '');
  const cases: [string, () => Promise<string> | string, number, number][] = [
    ['A5 receipt', () => receiptA5(receipt), 148 * MM, 210 * MM],
    [
      'voided A5 receipt',
      () => receiptA5({ ...receipt, status: 'void', voidedOn: '13 Sept 2026' }),
      148 * MM,
      210 * MM,
    ],
    ['thermal receipt', () => receiptThermal(receipt), 80 * MM, 190 * MM],
    [
      'student ID card',
      async () =>
        studentCard({
          letterhead,
          studentName: 'Hana Bekele Tadesse Worku Alemayehu',
          studentNumber: 'STU-2026-00001',
          validUntil: '12 Sept 2027',
          status: 'active',
          qr: raw(await qrSvg('https://example.test/verify/x')),
          verifyUrl: 'https://example.test/verify/x',
        }),
      85.6 * MM,
      54 * MM,
    ],
    [
      'certificate',
      async () =>
        certificate({
          letterhead,
          studentName: 'ሃና በቀለ ታደሰ Hana Bekele Tadesse',
          courseName: 'Advanced English for Professional Communication, Level C1',
          completedOn: '11 Dec 2026',
          serial: 'CERT-2026-00001',
          status: 'issued',
          qr: raw(await qrSvg('https://example.test/verify/x')),
          verifyUrl:
            'https://verify.example-institute.et/verify/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde',
        }),
      297 * MM,
      210 * MM,
    ],
  ];

  it.each(cases)('%s is one page at the right size', async (_name, build, width, height) => {
    const pdf = await renderer.render(await build());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
    const [w, h] = mediaBox(pdf);
    expect(w).toBeCloseTo(width, 0);
    expect(h).toBeCloseTo(height, 0);
  });

  it('draws Amharic with a font that has the letters', async () => {
    const pdf = await renderer.render(receiptA5(receipt));
    expect(pdf.toString('latin1')).toMatch(/NotoSansEthiopic/);
  });
});
