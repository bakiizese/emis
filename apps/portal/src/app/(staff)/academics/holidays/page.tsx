import type { Metadata } from 'next';

import { HolidaysScreen } from '@/features/academics/holidays-screen';

export const metadata: Metadata = { title: 'Holidays · Academics' };

export default function Page() {
  return <HolidaysScreen />;
}
