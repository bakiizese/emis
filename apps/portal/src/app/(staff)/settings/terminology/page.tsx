import type { Metadata } from 'next';

import { TerminologyScreen } from '@/features/settings/terminology-screen';

export const metadata: Metadata = { title: 'Terminology · Settings' };

export default function Page() {
  return <TerminologyScreen />;
}
