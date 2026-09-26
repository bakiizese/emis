import { Badge } from '@emis/ui/components/badge';
import type { Metadata } from 'next';
import Link from 'next/link';

import { LinkButton } from '../../components/link-button';
import { getPosts, getProfile } from '../../lib/api';
import { formatInstant, postKindLabel } from '../../lib/format';

export const metadata: Metadata = {
  title: 'News',
  description: 'Announcements and stories from our school.',
  alternates: { canonical: '/news', types: { 'application/rss+xml': '/feed.xml' } },
};

type Props = { searchParams: Promise<{ cursor?: string; kind?: string }> };

const KINDS = [
  ['', 'All'],
  ['announcement', 'Announcements'],
  ['news', 'News'],
  ['story', 'Stories'],
] as const;

export default async function NewsPage({ searchParams }: Props) {
  const query = await searchParams;
  const kind = KINDS.some(([k]) => k === query.kind) ? query.kind : undefined;
  const [profile, page] = await Promise.all([
    getProfile(),
    getPosts({ limit: 10, cursor: query.cursor, kind: kind || undefined }).catch(() => null),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">News</h1>
      <nav aria-label="Filter" className="mt-4 flex flex-wrap gap-2 text-sm">
        {KINDS.map(([value, label]) => (
          <Link
            key={value}
            href={value ? `/news?kind=${value}` : '/news'}
            aria-current={(kind ?? '') === value ? 'page' : undefined}
            className="border-border hover:bg-secondary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground rounded-full border px-3 py-1"
          >
            {label}
          </Link>
        ))}
      </nav>

      {page === null ? (
        <p className="text-muted-foreground mt-8">
          We can&apos;t load the news right now. Please try again later.
        </p>
      ) : page.items.length === 0 ? (
        <p className="text-muted-foreground mt-8">Nothing here yet.</p>
      ) : (
        <ul className="divide-border mt-6 divide-y">
          {page.items.map((post) => (
            <li key={post.slug} className="py-5">
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Badge tone="info">{postKindLabel(post.kind)}</Badge>
                <time dateTime={post.publishedAt}>
                  {formatInstant(post.publishedAt, profile.timezone)}
                </time>
              </div>
              <h2 className="mt-2 text-xl font-semibold">
                <Link href={`/news/${post.slug}`} className="hover:underline">
                  {post.title}
                </Link>
              </h2>
              {post.summary ? <p className="text-muted-foreground mt-1">{post.summary}</p> : null}
            </li>
          ))}
        </ul>
      )}

      {page?.nextCursor ? (
        <LinkButton
          href={`/news?cursor=${encodeURIComponent(page.nextCursor)}${kind ? `&kind=${kind}` : ''}`}
          variant="outline"
          className="mt-6"
        >
          Older posts
        </LinkButton>
      ) : null}
    </main>
  );
}
