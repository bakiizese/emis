import type { Metadata } from 'next';

import { ModulesScreen } from '@/features/settings/modules-screen';

export const metadata: Metadata = { title: 'Modules · Settings' };

export default function Page() {
  return <ModulesScreen />;
}
