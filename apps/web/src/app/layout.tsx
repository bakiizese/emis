import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';

import { SiteFooter } from '../components/site-footer';
import { SiteHeader } from '../components/site-header';
import { Unavailable } from '../components/unavailable';
import { getContact, getProfile, term } from '../lib/api';
import { siteUrl } from '../lib/site';

import './globals.css';

// Everything here reads live data from the API, so nothing is built ahead of time.
export const dynamic = 'force-dynamic';

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function generateMetadata(): Promise<Metadata> {
  const profile = await getProfile().catch(() => null);
  const name = profile?.name ?? 'Courses and registration';
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: name, template: `%s | ${name}` },
    description:
      profile?.tagline ??
      'Browse our courses, pick a shift that fits your day and pre-register online.',
    openGraph: { siteName: name, type: 'website' },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const profile = await getProfile().catch(() => null);
  const contact = profile?.modules.website ? await getContact().catch(() => null) : null;

  let body: ReactNode;
  if (!profile) {
    body = (
      <Unavailable
        title="We'll be right back"
        message="The site can't load its information right now. Please try again in a few minutes."
      />
    );
  } else if (!profile.modules.website) {
    body = (
      <Unavailable title={profile.name} message="Our website is not available at the moment." />
    );
  } else {
    body = (
      <>
        <SiteHeader
          name={profile.shortName}
          coursesLabel={term(profile, 'course', true)}
          canRegister={profile.modules.pre_registration}
        />
        <div className="min-h-[60dvh]">{children}</div>
        <SiteFooter name={profile.name} contact={contact} />
      </>
    );
  }

  return (
    <html
      lang="en"
      style={
        profile && HEX.test(profile.primaryColor)
          ? ({ '--brand-primary': profile.primaryColor } as CSSProperties)
          : undefined
      }
    >
      <body className="min-h-dvh font-sans antialiased">{body}</body>
    </html>
  );
}
