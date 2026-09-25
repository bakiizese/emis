import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AcceptInviteForm } from '@/features/auth/accept-invite-form';

export const metadata: Metadata = { title: 'Set up your account · EMIS' };

export default function Page() {
  return (
    <Suspense>
      <AcceptInviteForm />
    </Suspense>
  );
}
