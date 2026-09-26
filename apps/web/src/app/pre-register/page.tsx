import type { Metadata } from 'next';

import { LinkButton } from '../../components/link-button';
import { getCatalog, getContact, getProfile, getUpcoming } from '../../lib/api';

import { PreRegisterForm } from './pre-register-form';

export const metadata: Metadata = {
  title: 'Pre-register',
  description:
    'Tell us which course you want and how to reach you. We will contact you to confirm.',
  alternates: { canonical: '/pre-register' },
};

type Props = { searchParams: Promise<{ course?: string; class?: string }> };

export default async function PreRegisterPage({ searchParams }: Props) {
  const [profile, query] = await Promise.all([getProfile(), searchParams]);
  if (!profile.modules.pre_registration) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Online pre-registration is closed</h1>
        <p className="text-muted-foreground mt-2">
          Please contact us and we will help you register.
        </p>
        <LinkButton href="/contact" className="mt-6">
          Contact us
        </LinkButton>
      </main>
    );
  }

  const [catalog, classes, contact] = await Promise.all([
    getCatalog(),
    getUpcoming(50),
    getContact(),
  ]);
  const chosenClass = classes.find((c) => c.id === query.class);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Pre-register</h1>
      <p className="text-muted-foreground mt-2">
        Send us your details and we will contact you to confirm your place. This does not commit you
        to anything.
      </p>
      <PreRegisterForm
        catalog={catalog}
        classes={classes}
        branches={contact.branches}
        initial={{
          courseId: chosenClass?.courseId ?? query.course ?? '',
          shiftId: chosenClass?.shift.id ?? '',
          branchId: chosenClass?.branch.id ?? '',
        }}
      />
    </main>
  );
}
