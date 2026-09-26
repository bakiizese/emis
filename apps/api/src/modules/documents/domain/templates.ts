import { escapeHtml, markup, type Raw, raw, safeColor } from './html.js';

/** Who is printing: shown at the top of every document. */
export interface Letterhead {
  name: string;
  address: string | null;
  phone: string | null;
  color: string;
}

const FONT = "'Noto Sans', 'Noto Sans Ethiopic', 'Liberation Sans', Arial, sans-serif";

/** Wraps a body in a complete page. `size` is a CSS @page size, so Gotenberg uses it as the paper. */
function page(title: string, size: string, css: string, body: Raw): string {
  return markup`<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
@page { size: ${raw(size)}; margin: 0 }
* { box-sizing: border-box }
html, body { margin: 0; padding: 0; font-family: ${raw(FONT)}; color: #111; overflow: hidden }
${raw(css)}
</style></head><body>${body}</body></html>`.value;
}

const contact = (l: Letterhead) => [l.address, l.phone].filter(Boolean).join(' · ');

// --- receipts --------------------------------------------------------------------------------

export interface ReceiptData {
  letterhead: Letterhead;
  receiptNumber: string;
  date: string;
  studentName: string;
  invoiceNumber: string;
  method: string;
  reference: string | null;
  amountText: string;
  allocations: { label: string; amountText: string }[];
  status: 'posted' | 'void';
  voidedOn: string | null;
}

function receiptRows(d: ReceiptData): Raw {
  const rows: [string, string][] = [
    ['Receipt no.', d.receiptNumber],
    ['Date', d.date],
    ['Received from', d.studentName],
    ['For invoice', d.invoiceNumber],
    ['Method', d.reference ? `${d.method} · ${d.reference}` : d.method],
  ];
  return raw(rows.map(([k, v]) => markup`<tr><th>${k}</th><td>${v}</td></tr>`.value).join(''));
}

/** A5 portrait receipt for the front desk to print and hand over. */
export function receiptA5(d: ReceiptData): string {
  const color = safeColor(d.letterhead.color);
  const allocations = raw(
    d.allocations
      .map((a) => markup`<tr><td>${a.label}</td><td class="r">${a.amountText}</td></tr>`.value)
      .join(''),
  );
  return page(
    `Receipt ${d.receiptNumber}`,
    'A5',
    `
.sheet { width: 148mm; height: 210mm; padding: 14mm 12mm; position: relative; overflow: hidden }
h1 { margin: 0; font-size: 17pt; text-align: center; color: ${color} }
.sub { text-align: center; color: #555; font-size: 9pt; margin: 1mm 0 0 }
.title { text-align: center; letter-spacing: .25em; text-transform: uppercase; font-size: 9pt; color: #444; margin: 8mm 0 6mm }
table { width: 100%; border-collapse: collapse }
th { text-align: left; font-weight: 500; color: #555; width: 34mm; padding: 1.6mm 0; font-size: 10pt }
td { padding: 1.6mm 0; font-size: 10.5pt }
td.r { text-align: right }
.total { display: flex; justify-content: space-between; align-items: baseline; border-top: 1px solid #999; border-bottom: 1px solid #999; margin: 6mm 0 4mm; padding: 4mm 0 }
.total span:first-child { color: #555; font-size: 10pt }
.total span:last-child { font-size: 19pt; font-weight: 700 }
.alloc { font-size: 9pt; color: #444 }
.alloc caption { text-align: left; color: #555; padding-bottom: 1mm }
.void { position: absolute; top: 60mm; left: 22mm; transform: rotate(-24deg); font-size: 54pt; font-weight: 800; color: rgba(200,30,30,.35); border: 3mm solid rgba(200,30,30,.35); padding: 0 6mm; letter-spacing: .1em }
.note { margin-top: 6mm; font-size: 9pt; color: #a11 }
.foot { position: absolute; bottom: 12mm; left: 12mm; right: 12mm; text-align: center; font-size: 8pt; color: #777 }
`,
    markup`<div class="sheet">
${d.status === 'void' ? markup`<div class="void">VOID</div>` : ''}
<h1>${d.letterhead.name}</h1>
<p class="sub">${contact(d.letterhead)}</p>
<div class="title">Payment receipt</div>
<table>${receiptRows(d)}</table>
<div class="total"><span>Amount received</span><span>${d.amountText}</span></div>
<table class="alloc"><caption>Applied to</caption>${allocations}</table>
${d.status === 'void' ? markup`<p class="note">This receipt was voided${d.voidedOn ? ` on ${d.voidedOn}` : ''} and is no longer valid proof of payment.</p>` : ''}
<div class="foot">Thank you</div>
</div>`,
  );
}

/** 80 mm thermal-printer receipt (narrow, one column). */
export function receiptThermal(d: ReceiptData): string {
  const lines = raw(
    [
      ['Receipt', d.receiptNumber],
      ['Date', d.date],
      ['From', d.studentName],
      ['Invoice', d.invoiceNumber],
      ['Method', d.reference ? `${d.method} ${d.reference}` : d.method],
    ]
      .map(([k, v]) => markup`<div class="line"><span>${k}</span><span>${v}</span></div>`.value)
      .join(''),
  );
  const allocations = raw(
    d.allocations
      .map(
        (a) =>
          markup`<div class="line"><span>${a.label}</span><span>${a.amountText}</span></div>`.value,
      )
      .join(''),
  );
  return page(
    `Receipt ${d.receiptNumber}`,
    '80mm 190mm',
    `
.paper { width: 80mm; height: 190mm; padding: 5mm 4mm; font-size: 9.5pt; overflow: hidden }
h1 { font-size: 12pt; text-align: center; margin: 0 }
.sub { text-align: center; font-size: 8pt; margin: 1mm 0 3mm }
.rule { border-top: 1px dashed #000; margin: 2.5mm 0 }
.line { display: flex; justify-content: space-between; gap: 3mm; padding: .6mm 0 }
.line span:last-child { text-align: right; word-break: break-all }
.big { font-size: 13pt; font-weight: 700 }
.center { text-align: center }
`,
    markup`<div class="paper">
<h1>${d.letterhead.name}</h1>
<div class="sub">${contact(d.letterhead)}</div>
<div class="center">PAYMENT RECEIPT${d.status === 'void' ? ' - VOID' : ''}</div>
<div class="rule"></div>
${lines}
<div class="rule"></div>
<div class="line big"><span>TOTAL</span><span>${d.amountText}</span></div>
<div class="rule"></div>
${allocations}
<div class="rule"></div>
<div class="center">${d.status === 'void' ? 'NOT VALID - VOIDED' : 'Thank you'}</div>
</div>`,
  );
}

// --- student ID card -------------------------------------------------------------------------

export interface StudentCardData {
  letterhead: Letterhead;
  studentName: string;
  studentNumber: string;
  validUntil: string;
  status: 'active' | 'expired' | 'revoked';
  qr: Raw;
  verifyUrl: string;
}

/** CR80 (85.6 × 54 mm) student ID, front side. */
export function studentCard(d: StudentCardData): string {
  const color = safeColor(d.letterhead.color);
  const initials = d.studentName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0] ?? '')
    .join('')
    .toUpperCase();
  return page(
    `ID ${d.studentNumber}`,
    '85.6mm 54mm',
    `
.card { width: 85.6mm; height: 54mm; position: relative; overflow: hidden; background: #fff }
.band { background: ${color}; color: #fff; height: 11mm; padding: 0 4mm; display: flex; align-items: center; font-weight: 700; font-size: 9pt; letter-spacing: .04em }
.photo { position: absolute; left: 4mm; top: 15mm; width: 20mm; height: 25mm; background: ${color}22; border: .3mm solid ${color}; display: flex; align-items: center; justify-content: center; font-size: 20pt; font-weight: 700; color: ${color} }
.who { position: absolute; left: 27mm; top: 15mm; right: 4mm }
.who .name { font-size: 11pt; font-weight: 700; line-height: 1.15; max-height: 13mm; overflow: hidden }
.who .role { font-size: 7pt; color: #555; text-transform: uppercase; letter-spacing: .12em; margin-top: 1mm }
.who .num { font-family: 'Liberation Mono', monospace; font-size: 9pt; margin-top: 2.5mm }
.qr { position: absolute; right: 3mm; bottom: 3mm; width: 17mm; height: 17mm }
.qr svg { width: 100%; height: 100% }
.valid { position: absolute; left: 4mm; bottom: 3.5mm; font-size: 7pt; color: #444 }
.stamp { position: absolute; left: 4mm; bottom: 8mm; font-size: 8pt; font-weight: 800; color: #b00; letter-spacing: .1em }
`,
    markup`<div class="card">
<div class="band">${d.letterhead.name}</div>
<div class="photo">${initials}</div>
<div class="who"><div class="name">${d.studentName}</div><div class="role">Student</div><div class="num">${d.studentNumber}</div></div>
${d.status === 'active' ? '' : markup`<div class="stamp">${d.status === 'revoked' ? 'REVOKED' : 'EXPIRED'}</div>`}
<div class="valid">Valid until ${d.validUntil}</div>
<div class="qr">${d.qr}</div>
</div>`,
  );
}

// --- certificate -----------------------------------------------------------------------------

export interface CertificateData {
  letterhead: Letterhead;
  studentName: string;
  courseName: string;
  completedOn: string;
  serial: string;
  status: 'issued' | 'revoked';
  qr: Raw;
  verifyUrl: string;
}

/** A4 landscape certificate of completion with a QR code anyone can scan to verify it. */
export function certificate(d: CertificateData): string {
  const color = safeColor(d.letterhead.color);
  return page(
    `Certificate ${d.serial}`,
    'A4 landscape',
    `
.cert { width: 297mm; height: 210mm; padding: 12mm; position: relative; overflow: hidden }
.frame { height: 100%; border: 2.5mm double ${color}; padding: 14mm 20mm; text-align: center; position: relative }
.org { font-size: 20pt; font-weight: 700; color: ${color}; letter-spacing: .04em }
.contact { font-size: 9pt; color: #666; margin-top: 1mm }
.kicker { margin-top: 14mm; font-size: 26pt; letter-spacing: .18em; text-transform: uppercase; color: #333 }
.line { margin-top: 9mm; font-size: 12pt; color: #555 }
.name { margin-top: 4mm; font-size: 34pt; font-weight: 700; color: #111; border-bottom: .4mm solid ${color}; display: inline-block; padding: 0 12mm 1.5mm; max-width: 230mm; overflow: hidden }
.course { margin-top: 4mm; font-size: 21pt; font-weight: 600; color: ${color} }
.date { margin-top: 7mm; font-size: 12pt; color: #444 }
.bottom { position: absolute; left: 20mm; right: 20mm; bottom: 12mm; display: flex; justify-content: space-between; align-items: flex-end; text-align: left }
.serial { font-size: 9pt; color: #555; line-height: 1.6 }
.serial b { font-family: 'Liberation Mono', monospace; color: #111 }
.qr { width: 26mm; height: 26mm }
.qr svg { width: 100%; height: 100% }
.revoked { position: absolute; top: 78mm; left: 50mm; transform: rotate(-14deg); font-size: 70pt; font-weight: 800; color: rgba(200,30,30,.3); border: 4mm solid rgba(200,30,30,.3); padding: 0 10mm; letter-spacing: .1em }
`,
    markup`<div class="cert"><div class="frame">
${d.status === 'revoked' ? markup`<div class="revoked">REVOKED</div>` : ''}
<div class="org">${d.letterhead.name}</div>
<div class="contact">${contact(d.letterhead)}</div>
<div class="kicker">Certificate of Completion</div>
<div class="line">This certifies that</div>
<div class="name">${d.studentName}</div>
<div class="line">has successfully completed</div>
<div class="course">${d.courseName}</div>
<div class="date">on ${d.completedOn}</div>
<div class="bottom">
<div class="serial">Certificate no. <b>${d.serial}</b><br>Verify this certificate by scanning the code<br>or visiting ${d.verifyUrl}</div>
<div class="qr">${d.qr}</div>
</div>
</div></div>`,
  );
}

export { escapeHtml };
