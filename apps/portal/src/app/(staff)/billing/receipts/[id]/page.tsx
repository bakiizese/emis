import type { Metadata } from 'next';

import { ReceiptScreen } from '@/features/billing/receipt-screen';

export const metadata: Metadata = { title: 'Receipt · Billing' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReceiptScreen paymentId={id} />;
}
