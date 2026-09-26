/** Whole santim as a plain decimal for spreadsheets: 150000 → "1500.00". Integer maths only. */
export function decimalMoney(minorUnits: number): string {
  const sign = minorUnits < 0 ? '-' : '';
  const abs = Math.abs(minorUnits);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * One CSV cell. Quoted when needed (RFC 4180), and a cell that starts with = + - @ or a control
 * character gets a leading apostrophe so a spreadsheet can't run it as a formula (someone could
 * have typed one into a name). Money written with a minus sign is the one exception.
 */
export function csvCell(value: string | number, options: { numeric?: boolean } = {}): string {
  let text = String(value);
  if (!options.numeric && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/** A CSV document with a byte-order mark, so Excel reads Amharic and other non-Latin names correctly. */
export function toCsv(header: string[], rows: (string | number | { numeric: string })[][]): string {
  const line = (cells: (string | number | { numeric: string })[]) =>
    cells
      .map((cell) =>
        typeof cell === 'object' ? csvCell(cell.numeric, { numeric: true }) : csvCell(cell),
      )
      .join(',');
  return `${BYTE_ORDER_MARK}${[header, ...rows].map(line).join('\r\n')}\r\n`;
}
