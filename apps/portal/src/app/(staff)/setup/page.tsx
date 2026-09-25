import type { Metadata } from 'next';

import { SetupWizard } from '@/features/setup/setup-wizard';

export const metadata: Metadata = { title: 'Set up · EMIS' };

export default function Page() {
  return <SetupWizard />;
}
