import type { Metadata } from 'next';

import { ApprovalsScreen } from '@/features/billing/approvals-screen';

export const metadata: Metadata = { title: 'Approvals · Billing' };

export default function Page() {
  return <ApprovalsScreen />;
}
