const MAX_LENGTH = 60;

/**
 * A URL-safe slug from a title: lowercase letters and digits joined by single hyphens. Titles with
 * no Latin letters (say, Amharic) fall back to "post"; the caller adds a number if it's taken.
 */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LENGTH)
    .replace(/-+$/, '');
  return slug === '' ? 'post' : slug;
}

/** `base`, then `base-2`, `base-3`… the first one not in `taken`. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
