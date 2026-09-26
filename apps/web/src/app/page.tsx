import type { Metadata } from 'next';
import Link from 'next/link';

import { ClassList } from '../components/class-list';
import { JsonLd } from '../components/json-ld';
import { LinkButton } from '../components/link-button';
import { getCatalog, getContact, getPosts, getProfile, getUpcoming, term } from '../lib/api';
import { formatInstant, postKindLabel } from '../lib/format';
import { siteUrl } from '../lib/site';

export const metadata: Metadata = { alternates: { canonical: '/' } };

export default async function Home() {
  const profile = await getProfile();
  const [catalog, upcoming, contact, news] = await Promise.all([
    getCatalog().catch(() => ({ departments: [] })),
    getUpcoming(6).catch(() => []),
    getContact().catch(() => null),
    profile.modules.news ? getPosts({ limit: 3 }).catch(() => null) : null,
  ]);
  const canRegister = profile.modules.pre_registration;
  const courseWord = term(profile, 'course', true);

  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'EducationalOrganization',
          name: profile.name,
          url: siteUrl(),
          ...(profile.tagline ? { description: profile.tagline } : {}),
          ...(contact?.phone ? { telephone: contact.phone } : {}),
          ...(contact?.email ? { email: contact.email } : {}),
          ...(contact?.address
            ? {
                address: {
                  '@type': 'PostalAddress',
                  streetAddress: contact.address,
                  addressLocality: contact.city ?? undefined,
                },
              }
            : {}),
        }}
      />

      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            {profile.name}
          </h1>
          <p className="mt-4 max-w-2xl text-lg opacity-90">
            {profile.tagline ??
              'Pick a course, choose the shift that fits your day and pre-register online.'}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/courses" variant="secondary">
              Browse {courseWord.toLowerCase()}
            </LinkButton>
            {canRegister ? (
              <LinkButton
                href="/pre-register"
                variant="outline"
                className="border-white/40 hover:bg-white/10"
              >
                Pre-register
              </LinkButton>
            ) : null}
          </div>
        </div>
      </section>

      {catalog.departments.length > 0 ? (
        <section className="mx-auto max-w-6xl px-4 pt-14">
          <h2 className="text-2xl font-semibold tracking-tight">What you can study</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.departments.map((d) => (
              <li key={d.id} className="border-border bg-background rounded-xl border p-5">
                <h3 className="font-semibold">
                  <Link href={`/courses#${d.code.toLowerCase()}`} className="hover:underline">
                    {d.name}
                  </Link>
                </h3>
                {d.description ? (
                  <p className="text-muted-foreground mt-1 text-sm">{d.description}</p>
                ) : null}
                <p className="text-muted-foreground mt-3 text-sm">
                  {d.programs.map((p) => p.name).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {upcoming.length > 0 ? (
        <section className="mx-auto max-w-6xl px-4 pt-14">
          <h2 className="text-2xl font-semibold tracking-tight">Starting soon</h2>
          <p className="text-muted-foreground mt-1 text-sm">Seat numbers are live.</p>
          <div className="mt-6">
            <ClassList classes={upcoming} showCourse canRegister={canRegister} />
          </div>
        </section>
      ) : null}

      {news && news.items.length > 0 ? (
        <section className="mx-auto max-w-6xl px-4 pt-14">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-2xl font-semibold tracking-tight">Latest news</h2>
            <Link href="/news" className="text-primary text-sm hover:underline">
              All news
            </Link>
          </div>
          <ul className="mt-6 grid gap-4 sm:grid-cols-3">
            {news.items.map((post) => (
              <li key={post.slug} className="border-border bg-background rounded-xl border p-5">
                <p className="text-muted-foreground text-xs">
                  {postKindLabel(post.kind)} · {formatInstant(post.publishedAt, profile.timezone)}
                </p>
                <h3 className="mt-2 font-semibold">
                  <Link href={`/news/${post.slug}`} className="hover:underline">
                    {post.title}
                  </Link>
                </h3>
                {post.summary ? (
                  <p className="text-muted-foreground mt-1 line-clamp-3 text-sm">{post.summary}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canRegister ? (
        <section className="mx-auto max-w-6xl px-4 pt-14">
          <ol className="grid gap-4 sm:grid-cols-3">
            {[
              ['1', 'Pick a course', 'Look through the catalog and find your level.'],
              [
                '2',
                'Choose your shift',
                'Morning, afternoon, evening or weekend, whatever suits you.',
              ],
              [
                '3',
                'Pre-register',
                'Send your details. We call you to confirm and help you enrol.',
              ],
            ].map(([n, title, text]) => (
              <li key={n} className="bg-muted rounded-xl p-5">
                <span className="bg-primary text-primary-foreground inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold">
                  {n}
                </span>
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="text-muted-foreground mt-1 text-sm">{text}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}
