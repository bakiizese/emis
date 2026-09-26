export class CsvError extends Error {
  constructor(
    message: string,
    /** The line in the file where it went wrong (1-based). */
    readonly line: number,
  ) {
    super(message);
    this.name = 'CsvError';
  }
}

/**
 * Reads CSV text into rows of cells (RFC 4180): commas or semicolons are not guessed, quotes wrap
 * cells that contain commas, quotes ("" is a quote) or line breaks, and CRLF, LF and CR all end a
 * row. A leading byte-order mark (what Excel writes) is dropped. Blank lines are skipped.
 * Each row comes with the line it started on, so a mistake can be pointed at.
 */
export function parseCsv(input: string): { line: number; cells: string[] }[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let rowLine = 1;
  let line = 1;
  let cellStarted = false;

  const endCell = () => {
    cells.push(cell);
    cell = '';
    cellStarted = false;
  };
  const endRow = () => {
    endCell();
    if (!(cells.length === 1 && cells[0] === '')) rows.push({ line: rowLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && !cellStarted) {
      inQuotes = true;
      cellStarted = true;
    } else if (ch === ',') {
      endCell();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      cell += ch;
      cellStarted = true;
    }
  }
  if (inQuotes) throw new CsvError('A quoted value is never closed', rowLine);
  if (cellStarted || cells.length > 0 || cell !== '') endRow();
  return rows;
}
