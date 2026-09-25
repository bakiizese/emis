import type { ReactNode } from 'react';

import { BillingNav } from '@/features/billing/billing-nav';

export default function BillingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight print:hidden">Billing</h1>
      <div className="grid gap-6 md:grid-cols-[12rem_1fr] print:block">
        <BillingNav />
        <div className="min-w-0 space-y-6">{children}</div>
      </div>
    </div>
  );
}
