import { describe, expect, it } from 'vitest';

import { buildRss, xmlEscape } from './rss';

describe('xmlEscape', () => {
  it('escapes the five XML characters', () =>
    expect(xmlEscape(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;',
    ));
  it('drops characters XML cannot carry', () =>
    expect(xmlEscape('a\u0000b\u0008c\td')).toBe('abc\td'));
});

describe('buildRss', () => {
  const feed = buildRss({
    title: 'Lingua & Co',
    link: 'https://lingua.test',
    description: 'News',
    items: [
      {
        title: '<script>alert(1)</script>',
        link: 'https://lingua.test/news/x',
        description: 'Summary ]]> text',
        publishedAt: '2026-09-26T05:59:01.323Z',
      },
    ],
  });

  it('is an RSS 2.0 document with the item', () => {
    expect(feed).toContain('<rss version="2.0">');
    expect(feed).toContain('<pubDate>Sat, 26 Sep 2026 05:59:01 GMT</pubDate>');
    expect(feed).toContain('<guid isPermaLink="true">https://lingua.test/news/x</guid>');
  });

  it('never lets a title or summary inject markup', () => {
    expect(feed).not.toContain('<script>');
    expect(feed).toContain('&lt;script&gt;');
    expect(feed).toContain('Lingua &amp; Co');
    expect(feed).not.toContain(']]>');
  });
});
