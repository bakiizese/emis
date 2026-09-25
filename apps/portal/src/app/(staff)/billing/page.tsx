import type { Metadata } from 'next';

import { InvoicesScreen } from '@/features/billing/invoices-screen';

export const metadata: Metadata = { title: 'Invoices · Billing' };

export default function Page() {
  return <InvoicesScreen />;
}
