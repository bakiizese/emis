import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SetupMfaFlow } from '@/features/auth/setup-mfa-flow';

export const metadata: Metadata = { title: 'Set up two-factor authentication · EMIS' };

export default function Page() {
  return (
    <Suspense>
      <SetupMfaFlow />
    </Suspense>
  );
}
