import type { Metadata } from 'next';

import { ReportsScreen } from '@/features/reports/reports-screen';

export const metadata: Metadata = { title: 'Reports' };

export default function Page() {
  return <ReportsScreen />;
}
