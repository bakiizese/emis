import type { Metadata } from 'next';

import { BranchesScreen } from '@/features/settings/branches-screen';

export const metadata: Metadata = { title: 'Branches · Settings' };

export default function Page() {
  return <BranchesScreen />;
}
