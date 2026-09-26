import type { StudentImportColumn } from '@emis/contracts';

/** Other spellings people use for each column, all compared after tidying (lowercase, underscores). */
const ALIASES: Record<StudentImportColumn, string[]> = {
  given_name: ['given_name', 'first_name', 'firstname', 'given', 'name'],
  father_name: ['father_name', 'fathers_name', 'father', 'middle_name'],
  grandfather_name: ['grandfather_name', 'grandfathers_name', 'grandfather'],
  gender: ['gender', 'sex'],
  date_of_birth: ['date_of_birth', 'dob', 'birth_date', 'birthdate', 'birthday'],
  phone: ['phone', 'phone_number', 'mobile', 'telephone', 'tel'],
  email: ['email', 'email_address', 'e_mail'],
  address: ['address'],
  city: ['city', 'town'],
  branch: ['branch', 'branch_code', 'campus'],
  category: ['category', 'student_category'],
  guardian_name: ['guardian_name', 'guardian', 'parent_name', 'parent'],
  guardian_relationship: ['guardian_relationship', 'relationship', 'parent_relationship'],
  guardian_phone: ['guardian_phone', 'parent_phone', 'guardian_mobile'],
  guardian_email: ['guardian_email', 'parent_email'],
};

/** "First Name", "first-name" and " FIRST_NAME " are the same heading. */
export const tidyHeading = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[\s\-.]+/g, '_')
    .replace(/[^\p{L}\p{N}_]/gu, '')
    .replace(/^_+|_+$/g, '');

export interface HeaderMap {
  /** Column position in the file for each column the import uses. */
  index: Partial<Record<StudentImportColumn, number>>;
  /** Headings in the file that match nothing (shown to the user so a typo is noticed). */
  ignored: string[];
}

export function mapHeader(headings: string[]): HeaderMap {
  const index: HeaderMap['index'] = {};
  const ignored: string[] = [];
  headings.forEach((heading, position) => {
    const tidy = tidyHeading(heading);
    const column = (Object.keys(ALIASES) as StudentImportColumn[]).find((key) =>
      ALIASES[key].includes(tidy),
    );
    if (column && index[column] === undefined) index[column] = position;
    else if (heading.trim() !== '') ignored.push(heading.trim());
  });
  return { index, ignored };
}

const REQUIRED: StudentImportColumn[] = ['given_name', 'father_name', 'gender', 'phone', 'branch'];

export const missingColumns = (map: HeaderMap): StudentImportColumn[] =>
  REQUIRED.filter((column) => map.index[column] === undefined);

/** "M", "male", "Female", "woman" → the two values the system stores; anything else stays as typed so it fails. */
export function normalizeGender(value: string): string {
  const v = value.trim().toLowerCase();
  if (['f', 'female', 'woman', 'girl'].includes(v)) return 'female';
  if (['m', 'male', 'man', 'boy'].includes(v)) return 'male';
  return v;
}

/**
 * A birth date as YYYY-MM-DD, from that or from DD/MM/YYYY (also with dashes or dots), the way dates
 * are usually written here. Returns the input unchanged when it isn't either, so validation says so.
 */
export function normalizeDate(value: string): string {
  const v = value.trim();
  if (v === '') return '';
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (!dmy) return v;
  const [, d, m, y] = dmy as unknown as [string, string, string, string];
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** The cell for `column` in a row of cells, tidied, or '' when the file has no such column. */
export function cellOf(
  map: HeaderMap,
  cells: readonly string[],
  column: StudentImportColumn,
): string {
  const position = map.index[column];
  return position === undefined ? '' : (cells[position] ?? '').trim();
}
