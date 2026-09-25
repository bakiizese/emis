import type { Metadata } from 'next';

import { GeneralScreen } from '@/features/settings/general-screen';

export const metadata: Metadata = { title: 'General · Settings' };

export default function Page() {
  return <GeneralScreen />;
}
