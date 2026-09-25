import type { Metadata } from 'next';

import { NumberingScreen } from '@/features/settings/numbering-screen';

export const metadata: Metadata = { title: 'Numbering · Settings' };

export default function Page() {
  return <NumberingScreen />;
}
