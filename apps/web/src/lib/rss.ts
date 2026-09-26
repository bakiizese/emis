export interface RssItem {
  title: string;
  link: string;
  description: string;
  publishedAt: string;
}

// Characters XML 1.0 forbids (most control characters) would make the whole feed unreadable.
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

export const xmlEscape = (value: string): string =>
  value
    .replace(ILLEGAL, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** An RSS 2.0 feed. Every value is escaped, so a title can't break out of its element. */
export function buildRss(feed: {
  title: string;
  link: string;
  description: string;
  items: RssItem[];
}): string {
  const items = feed.items
    .map(
      (item) => `    <item>
      <title>${xmlEscape(item.title)}</title>
      <link>${xmlEscape(item.link)}</link>
      <guid isPermaLink="true">${xmlEscape(item.link)}</guid>
      <pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate>
      <description>${xmlEscape(item.description)}</description>
    </item>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xmlEscape(feed.title)}</title>
    <link>${xmlEscape(feed.link)}</link>
    <description>${xmlEscape(feed.description)}</description>
${items}
  </channel>
</rss>
`;
}
