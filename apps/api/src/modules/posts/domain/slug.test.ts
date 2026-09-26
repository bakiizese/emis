import { describe, expect, it } from 'vitest';

import { slugify, uniqueSlug } from './slug.js';

describe('slugify', () => {
  it.each([
    ['New Evening Classes Open', 'new-evening-classes-open'],
    ['  Café  &  Résumé: 2027!  ', 'cafe-resume-2027'],
    ['Python -- start today', 'python-start-today'],
  ])('%s → %s', (title, slug) => expect(slugify(title)).toBe(slug));

  it('falls back when nothing Latin is left', () => {
    expect(slugify('አዲስ ኮርስ')).toBe('post');
    expect(slugify('!!!')).toBe('post');
  });

  it('keeps it short and never ends on a hyphen', () => {
    const slug = slugify('word '.repeat(40));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('never yields anything the database format check would refuse', () => {
    for (const title of ['A', '--x--', 'ÀÉÎ', '日本語 news', '123']) {
      expect(slugify(title)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe('uniqueSlug', () => {
  it('keeps a free slug', () => expect(uniqueSlug('news', new Set())).toBe('news'));
  it('numbers a taken one, skipping taken numbers', () =>
    expect(uniqueSlug('news', new Set(['news', 'news-2', 'news-3']))).toBe('news-4'));
});
