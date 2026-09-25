/** Escape `%`, `_` and `\` so user text matches literally inside an ILIKE pattern. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Words of a search box query, lower-cased, so "hana bek" matches "Hana Bekele" whatever the word
 * order. Capped so a long paste can't build a huge query.
 */
export function searchTokens(query: string, max = 5): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, max);
}

/**
 * ILIKE pattern to find a phone number from a search word, or null when the word isn't
 * phone-like. Numbers are stored as "+251944555666" but typed as "0944 555", so leading zeros
 * are dropped and only the digits from there are matched.
 */
export function phonePattern(token: string): string | null {
  const local = token.replace(/\D/g, '').replace(/^0+/, '');
  return local.length >= 3 ? `%${local}%` : null;
}
