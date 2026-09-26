import { describe, expect, it } from 'vitest';

import { csvCell, decimalMoney, toCsv } from './csv.js';

describe('decimalMoney', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [150_000, '1500.00'],
    [123_456_789, '1234567.89'],
    [-2_550, '-25.50'],
  ])('%i → %s', (santim, text) => expect(decimalMoney(santim)).toBe(text));
});

describe('csvCell', () => {
  it('leaves plain text alone', () => expect(csvCell('Abebe Kebede')).toBe('Abebe Kebede'));
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Kebede, Abebe')).toBe('"Kebede, Abebe"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });
  it.each(['=SUM(A1:A9)', '+1+1', '-2+3', '@cmd', '\tx'])('defuses the formula %j', (text) => {
    expect(csvCell(text).replace(/^"/, '')).toMatch(/^'/);
  });
  it('lets a number keep its minus sign', () =>
    expect(csvCell('-25.50', { numeric: true })).toBe('-25.50'));
});

describe('toCsv', () => {
  it('starts with a byte-order mark and ends each row with CRLF', () => {
    const csv = toCsv(['Name', 'Owed'], [['Selam', { numeric: '750.00' }]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('Name,Owed\r\nSelam,750.00\r\n');
  });
  it('keeps Amharic text as it is', () =>
    expect(toCsv(['ስም'], [['አበበ']]).slice(1)).toBe('ስም\r\nአበበ\r\n'));
});
