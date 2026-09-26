import { Badge } from '@emis/ui/components/badge';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { JsonLd } from '../../../components/json-ld';
import { getPost, getProfile, NotFoundError } from '../../../lib/api';
import { formatInstant, paragraphs, postKindLabel } from '../../../lib/format';
import { siteUrl } from '../../../lib/site';

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  try {
    return await getPost(slug);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await load((await params).slug);
  const description = post.summary || paragraphs(post.body)[0]?.slice(0, 160);
  return {
    title: post.title,
    description,
    alternates: { canonical: `/news/${post.slug}` },
    openGraph: { type: 'article', title: post.title, description, publishedTime: post.publishedAt },
  };
}

export default async function PostPage({ params }: Props) {
  const [post, profile] = await Promise.all([load((await params).slug), getProfile()]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'NewsArticle',
          headline: post.title,
          datePublished: post.publishedAt,
          url: `${siteUrl()}/news/${post.slug}`,
          publisher: { '@type': 'Organization', name: profile.name },
        }}
      />
      <Link href="/news" className="text-muted-foreground text-sm hover:underline">
        ← All news
      </Link>
      <div className="text-muted-foreground mt-4 flex items-center gap-2 text-sm">
        <Badge tone="info">{postKindLabel(post.kind)}</Badge>
        <time dateTime={post.publishedAt}>{formatInstant(post.publishedAt, profile.timezone)}</time>
      </div>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{post.title}</h1>
      {post.summary ? <p className="text-muted-foreground mt-3 text-lg">{post.summary}</p> : null}
      <div className="mt-6 space-y-4 leading-relaxed">
        {paragraphs(post.body).map((text, i) => (
          <p key={i} className="whitespace-pre-line">
            {text}
          </p>
        ))}
      </div>
    </main>
  );
}
