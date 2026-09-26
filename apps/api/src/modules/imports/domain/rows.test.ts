import { describe, expect, it } from 'vitest';

import {
  cellOf,
  mapHeader,
  missingColumns,
  normalizeDate,
  normalizeGender,
  tidyHeading,
} from './rows.js';

describe('tidyHeading', () => {
  it.each([
    ['First Name', 'first_name'],
    [' FATHER-NAME ', 'father_name'],
    ['Date of Birth', 'date_of_birth'],
    ['E-mail', 'e_mail'],
    ['Phone #', 'phone'],
  ])('%s → %s', (heading, tidy) => expect(tidyHeading(heading)).toBe(tidy));
});

describe('mapHeader', () => {
  it('finds columns by name or alias and reports the ones it does not know', () => {
    const map = mapHeader([
      'First Name',
      "Father's Name",
      'Sex',
      'Mobile',
      'Campus',
      'Favourite colour',
      '',
    ]);
    expect(map.index).toEqual({ given_name: 0, father_name: 1, gender: 2, phone: 3, branch: 4 });
    expect(map.ignored).toEqual(['Favourite colour']);
  });

  it('uses the first of two columns that mean the same thing', () => {
    const map = mapHeader(['phone', 'mobile']);
    expect(map.index.phone).toBe(0);
    expect(map.ignored).toEqual(['mobile']);
  });

  it('says which required columns are missing', () =>
    expect(missingColumns(mapHeader(['given_name', 'phone']))).toEqual([
      'father_name',
      'gender',
      'branch',
    ]));
});

describe('normalizeGender', () => {
  it.each([
    ['F', 'female'],
    [' Male ', 'male'],
    ['woman', 'female'],
    ['other', 'other'],
  ])('%s → %s', (input, out) => expect(normalizeGender(input)).toBe(out));
});

describe('normalizeDate', () => {
  it.each([
    ['2001-04-23', '2001-04-23'],
    ['23/04/2001', '2001-04-23'],
    ['3.4.2001', '2001-04-03'],
    ['', ''],
    ['April 2001', 'April 2001'],
  ])('%s → %s', (input, out) => expect(normalizeDate(input)).toBe(out));
});

describe('cellOf', () => {
  it('reads a cell by column, empty when missing', () => {
    const map = mapHeader(['given_name', 'phone']);
    expect(cellOf(map, [' Abebe ', '0911'], 'given_name')).toBe('Abebe');
    expect(cellOf(map, ['Abebe'], 'phone')).toBe('');
    expect(cellOf(map, ['Abebe', '0911'], 'email')).toBe('');
  });
});
