import { IMPORT_ERROR_CODES as c } from '@emis/contracts';
import { UnprocessableEntityException } from '@nestjs/common';

export const importErrors = {
  invalidFile: (message: string) =>
    new UnprocessableEntityException({ code: c.invalidFile, message }),
  tooManyRows: (max: number) =>
    new UnprocessableEntityException({
      code: c.tooManyRows,
      message: `A file can have at most ${max.toLocaleString('en')} students. Split it into smaller files.`,
    }),
  missingColumns: (columns: string[]) =>
    new UnprocessableEntityException({
      code: c.missingColumns,
      message: `The file has no column for: ${columns.join(', ')}. Check the first line against the template.`,
    }),
};
