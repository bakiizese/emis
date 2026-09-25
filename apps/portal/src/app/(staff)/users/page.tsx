import type { Metadata } from 'next';

import { UsersScreen } from '@/features/staff/users-screen';

export const metadata: Metadata = { title: 'Staff · EMIS' };

export default function Page() {
  return <UsersScreen />;
}
