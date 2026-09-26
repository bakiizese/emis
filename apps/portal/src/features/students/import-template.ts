import { STUDENT_IMPORT_COLUMNS } from '@emis/contracts';

const cell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** A CSV with every column the import understands and one example row to copy the style from. */
export function studentImportTemplate(): string {
  const header = STUDENT_IMPORT_COLUMNS.map((c) => c.key).join(',');
  const example = STUDENT_IMPORT_COLUMNS.map((c) => cell(c.example)).join(',');
  return `${header}\r\n${example}\r\n`;
}
