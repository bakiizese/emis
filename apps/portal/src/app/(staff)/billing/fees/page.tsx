import type { Metadata } from 'next';

import { FeesScreen } from '@/features/billing/fees-screen';

export const metadata: Metadata = { title: 'Fees and plans · Billing' };

export default function Page() {
  return <FeesScreen />;
}
