import type { Metadata } from 'next';

import { ShiftsScreen } from '@/features/academics/shifts-screen';

export const metadata: Metadata = { title: 'Shifts · Academics' };

export default function Page() {
  return <ShiftsScreen />;
}
