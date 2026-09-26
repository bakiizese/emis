import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CsvError, parseCsv } from './csv-parse.js';

const cells = (text: string) => parseCsv(text).map((r) => r.cells);

describe('parseCsv', () => {
  it('reads plain rows with any line ending', () => {
    expect(cells('a,b\r\nc,d\ne,f\rg,h')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
      ['g', 'h'],
    ]);
  });

  it('drops a byte-order mark and a final newline', () =>
    expect(cells('﻿a,b\nc,d\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]));

  it('handles quotes, commas, doubled quotes and line breaks inside a cell', () =>
    expect(cells('"Kebede, Abebe","say ""hi""","two\nlines"\n')).toEqual([
      ['Kebede, Abebe', 'say "hi"', 'two\nlines'],
    ]));

  it('keeps empty cells and skips blank lines', () =>
    expect(cells('a,,c\n\n,,\nd,e,f')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
      ['d', 'e', 'f'],
    ]));

  it('tells you which line each row started on, even after a multi-line cell', () => {
    const rows = parseCsv('h1,h2\n"a\nb",c\nd,e');
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4]);
  });

  it('keeps Amharic text', () => expect(cells('አበበ,ከበደ')).toEqual([['አበበ', 'ከበደ']]));

  it('refuses a quote that never closes, saying where it began', () => {
    expect(() => parseCsv('a,b\n"open,c\nd,e')).toThrow(CsvError);
    try {
      parseCsv('a,b\n"open,c\nd,e');
    } catch (error) {
      expect((error as CsvError).line).toBe(2);
    }
  });

  it('keeps a quote that appears in the middle of an unquoted cell', () =>
    expect(cells('ab"c,d')).toEqual([['ab"c', 'd']]));

  it('reads back whatever a quoting writer produces', () => {
    const write = (rows: string[][]) =>
      rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n');
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.string({ unit: 'grapheme' }), { minLength: 1, maxLength: 6 }), {
          minLength: 1,
          maxLength: 8,
        }),
        (rows) => {
          // A row of one empty cell is a blank line, which the parser skips by design.
          const meaningful = rows.filter((r) => !(r.length === 1 && r[0] === ''));
          expect(cells(write(rows))).toEqual(meaningful);
        },
      ),
    );
  });
});
