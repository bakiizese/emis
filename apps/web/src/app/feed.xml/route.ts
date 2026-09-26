import { getPosts, getProfile } from '../../lib/api';
import { buildRss } from '../../lib/rss';
import { siteUrl } from '../../lib/site';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const profile = await getProfile().catch(() => null);
  if (!profile?.modules.website || !profile.modules.news) {
    return new Response('Not found', { status: 404 });
  }
  const { items } = await getPosts({ limit: 30 }).catch(() => ({ items: [] }));
  const base = siteUrl();
  const xml = buildRss({
    title: profile.name,
    link: base,
    description: profile.tagline ?? `News from ${profile.name}`,
    items: items.map((post) => ({
      title: post.title,
      link: `${base}/news/${post.slug}`,
      description: post.summary,
      publishedAt: post.publishedAt,
    })),
  });
  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
