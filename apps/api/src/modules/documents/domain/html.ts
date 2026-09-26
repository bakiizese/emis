/**
 * HTML for PDFs is built with the `markup` tag below: every `${value}` is escaped unless it was
 * wrapped in `raw()`. Names come from people, and Chromium fetches whatever a page points at,
 * so an unescaped `<img src=http://internal>` in a student's name would be a server-side request
 * forgery. Templates never contain external URLs either; the QR code is inline SVG.
 */
const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/** Markup that is already safe (e.g. an SVG we generated); `markup` leaves it as is. */
export class Raw {
  constructor(readonly value: string) {}
}
export const raw = (value: string): Raw => new Raw(value);

type Interpolation = string | number | null | undefined | Raw | readonly Raw[];

export function markup(strings: TemplateStringsArray, ...values: Interpolation[]): Raw {
  let out = strings[0] ?? '';
  values.forEach((value, i) => {
    let piece = '';
    if (value instanceof Raw) piece = value.value;
    else if (Array.isArray(value)) piece = (value as readonly Raw[]).map((r) => r.value).join('');
    else if (typeof value === 'string' || typeof value === 'number')
      piece = escapeHtml(String(value));
    out += piece + (strings[i + 1] ?? '');
  });
  return raw(out);
}

/** A brand colour that is safe to put in CSS: a 6-digit hex, otherwise the fallback. */
export function safeColor(value: string, fallback = '#1d4ed8'): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}
