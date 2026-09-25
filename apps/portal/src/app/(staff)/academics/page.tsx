import type { Metadata } from 'next';

import { ProgramsScreen } from '@/features/academics/programs-screen';

export const metadata: Metadata = { title: 'Programs · Academics' };

export default function Page() {
  return <ProgramsScreen />;
}
