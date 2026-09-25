import type { Metadata } from 'next';
import { Suspense } from 'react';

import { VerifyMfaForm } from '@/features/auth/verify-mfa-form';

export const metadata: Metadata = { title: 'Two-factor authentication · EMIS' };

export default function Page() {
  return (
    <Suspense>
      <VerifyMfaForm />
    </Suspense>
  );
}
