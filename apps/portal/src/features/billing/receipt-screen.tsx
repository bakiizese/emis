'use client';

import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import Link from 'next/link';

import { useInstitution } from '@/features/institution/use-institution';
import { errorMessage } from '@/lib/api';

import { useMoney } from './money';
import { usePayment } from './use-billing';

/** A printable receipt: institution header, who paid what, and how it was applied. */
export function ReceiptScreen({ paymentId }: { paymentId: string }) {
  const { fmt } = useMoney();
  const { profile } = useInstitution();
  const payment = usePayment(paymentId);

  if (payment.error) return <Alert tone="error">{errorMessage(payment.error)}</Alert>;
  const p = payment.data;
  if (!p) return null;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex justify-between gap-2 print:hidden">
        <Link
          href={`/billing/invoices/${p.invoiceId}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Back to the invoice
        </Link>
        <Button onClick={() => window.print()}>Print</Button>
      </div>

      <article className="border-border relative space-y-6 rounded-xl border p-8 print:border-0 print:p-0">
        {p.status === 'void' ? (
          <p className="absolute top-6 right-8 rotate-6 rounded border-2 border-red-600 px-3 py-1 text-lg font-bold tracking-widest text-red-600 uppercase">
            Void
          </p>
        ) : null}
        <header className="space-y-1 text-center">
          <h2 className="text-xl font-semibold">{profile?.name ?? ''}</h2>
          <p className="text-muted-foreground text-sm tracking-widest uppercase">Payment receipt</p>
        </header>
        <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Receipt no.</dt>
          <dd className="font-mono font-medium">{p.receiptNumber}</dd>
          <dt className="text-muted-foreground">Date</dt>
          <dd>
            {new Date(p.receivedAt).toLocaleString(undefined, {
              dateStyle: 'long',
              timeStyle: 'short',
            })}
          </dd>
          <dt className="text-muted-foreground">Received from</dt>
          <dd>{p.studentName}</dd>
          <dt className="text-muted-foreground">For invoice</dt>
          <dd className="font-mono">{p.invoiceNumber}</dd>
          <dt className="text-muted-foreground">Method</dt>
          <dd>
            {p.method.replaceAll('_', ' ')}
            {p.reference ? ` · ${p.reference}` : ''}
          </dd>
        </dl>
        <div className="border-border flex items-baseline justify-between border-y py-4">
          <span className="text-muted-foreground text-sm">Amount received</span>
          <span className="text-2xl font-semibold">{fmt(p.amount)}</span>
        </div>
        <div className="text-muted-foreground text-xs">
          Applied to instalment{p.allocations.length === 1 ? '' : 's'}{' '}
          {p.allocations.map((a) => `#${a.sequence} (${fmt(a.amount)})`).join(', ')}.
        </div>
        {p.status === 'void' ? (
          <p className="text-sm text-red-700 dark:text-red-300">
            This receipt was voided
            {p.voidedAt ? ` on ${new Date(p.voidedAt).toLocaleDateString()}` : ''}. It is no longer
            valid proof of payment.
          </p>
        ) : null}
      </article>
    </div>
  );
}
