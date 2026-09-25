import type { Metadata } from 'next';

import { IntakesScreen } from '@/features/academics/intakes-screen';

export const metadata: Metadata = { title: 'Intakes · Academics' };

export default function Page() {
  return <IntakesScreen />;
}
