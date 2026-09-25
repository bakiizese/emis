import type { Metadata } from 'next';

import { YearsScreen } from '@/features/academics/years-screen';

export const metadata: Metadata = { title: 'Academic years · Academics' };

export default function Page() {
  return <YearsScreen />;
}
