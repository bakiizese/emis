import type { Metadata } from 'next';

import { ListsScreen } from '@/features/settings/lists-screen';

export const metadata: Metadata = { title: 'Dropdown lists · Settings' };

export default function Page() {
  return <ListsScreen />;
}
