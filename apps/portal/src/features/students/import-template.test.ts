import { STUDENT_IMPORT_COLUMNS } from '@emis/contracts';
import { describe, expect, it } from 'vitest';

import { studentImportTemplate } from './import-template';

describe('studentImportTemplate', () => {
  const [header, example] = studentImportTemplate().split('\r\n');

  it('has every column the import understands, in order', () =>
    expect(header?.split(',')).toEqual(STUDENT_IMPORT_COLUMNS.map((c) => c.key)));

  it('has one example row of the same width', () =>
    expect(example?.split(',').length).toBe(STUDENT_IMPORT_COLUMNS.length));

  it('ends with a line break', () => expect(studentImportTemplate().endsWith('\r\n')).toBe(true));
});
