'use client';

import {
  approvalSchema,
  type Invoice,
  METHODS_NEEDING_REFERENCE,
  PAYMENT_METHODS,
  parseMoney,
  type Payment,
  type PaymentMethod,
  paymentSchema,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { SelectField } from '@emis/ui/components/select';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { SectionHeader } from '@/components/section-header';
import { SimpleTable } from '@/components/simple-table';
import { formatDate } from '@/features/academics/use-catalog';
import { useDescriptorOptions } from '@/features/people/use-lists';
import { useSession } from '@/features/session/use-session';
import { apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

import { invoiceLabel, invoiceTone } from './invoices-screen';
import { MONEY_HINT, MoneyInput, useMoney } from './money';
import { useInvoice, useInvoicePayments } from './use-billing';

const installmentTone = {
  paid: 'success',
  partial: 'warning',
  due: 'neutral',
  overdue: 'danger',
} as const;
const methodLabel = (m: string) => m.charAt(0).toUpperCase() + m.slice(1).replaceAll('_', ' ');

function useRefresh(invoiceId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['invoices'] });
    await queryClient.invalidateQueries({ queryKey: ['payments'] });
    await queryClient.invalidateQueries({ queryKey: ['invoices', 'one', invoiceId] });
  };
}

function PaymentForm({ invoice, onDone }: { invoice: Invoice; onDone: (message: string) => void }) {
  const { fmt } = useMoney();
  const refresh = useRefresh(invoice.id);
  const idempotency = useIdempotencyKey();
  const nextOwed = invoice.installments.find((i) => i.paidAmount < i.amount);
  const suggested = nextOwed ? nextOwed.amount - nextOwed.paidAmount : 0;
  const [text, setText] = useState((suggested / 100).toFixed(2));
  const [minor, setMinor] = useState<number | null>(suggested);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const needsReference = METHODS_NEEDING_REFERENCE.includes(method);

  const save = useMutation({
    mutationFn: () => {
      const body = { invoiceId: invoice.id, amount: minor, method, reference };
      return apiRequest('/payments', {
        method: 'POST',
        body,
        schema: paymentSchema,
        idempotencyKey: idempotency.keyFor(body),
      });
    },
    onSuccess: async (payment) => {
      idempotency.reset();
      await refresh();
      onDone(`Recorded ${fmt(payment.amount)}. Receipt ${payment.receiptNumber}.`);
    },
  });
  const invalid = minor === null || minor < 1 || (needsReference && reference.trim() === '');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Record a payment</CardTitle>
      </CardHeader>
      <form
        className="grid gap-4 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <MoneyInput
          label="Amount received"
          value={text}
          hint={
            minor === null && text !== ''
              ? MONEY_HINT
              : `Owes ${fmt(invoice.balance)} in total. It goes to the oldest instalment first.`
          }
          error={minor === null && text !== '' ? MONEY_HINT : undefined}
          onChange={(value, parsed) => {
            setText(value);
            setMinor(parsed);
          }}
        />
        <SelectField
          label="How"
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {methodLabel(m)}
            </option>
          ))}
        </SelectField>
        <Field
          label={
            needsReference
              ? method === 'cheque'
                ? 'Cheque number'
                : 'Bank slip number'
              : 'Reference (optional)'
          }
          value={reference}
          required={needsReference}
          onChange={(e) => setReference(e.target.value)}
        />
        {save.error ? (
          <Alert tone="error" className="sm:col-span-3">
            {errorMessage(save.error)}
          </Alert>
        ) : null}
        <div className="flex justify-end sm:col-span-3">
          <Button type="submit" disabled={invalid || save.isPending}>
            {save.isPending ? 'Recording…' : 'Record payment and issue receipt'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function DiscountForm({
  invoice,
  onDone,
}: {
  invoice: Invoice;
  onDone: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const reasons = useDescriptorOptions('discount_reason');
  const [kind, setKind] = useState<'percent' | 'fixed'>('percent');
  const [text, setText] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');

  /** Percent: basis points (10 → 1000). Fixed: exact minor units via parseMoney, never float maths. */
  const value =
    kind === 'fixed'
      ? parseMoney(text)
      : (() => {
          const n = Number(text.trim());
          return text.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
        })();

  const request = useMutation({
    mutationFn: () =>
      apiRequest(`/invoices/${invoice.id}/discount-requests`, {
        method: 'POST',
        body: { kind, value, reasonCode, note },
        schema: approvalSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['approvals'] });
      onDone('Discount requested. It applies once someone else approves it.');
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ask for a discount</CardTitle>
      </CardHeader>
      <form
        className="grid gap-4 sm:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          request.mutate();
        }}
      >
        <SelectField
          label="Type"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
        >
          <option value="percent">Percentage</option>
          <option value="fixed">Fixed amount</option>
        </SelectField>
        <Field
          label={kind === 'percent' ? 'Percent off' : 'Amount off'}
          inputMode="decimal"
          value={text}
          hint={kind === 'percent' ? 'e.g. 10 for 10%' : 'In the institution currency'}
          onChange={(e) => setText(e.target.value)}
        />
        <SelectField
          label="Reason"
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
        >
          <option value="">Choose…</option>
          {reasons.data?.map((r) => (
            <option key={r.code} value={r.code}>
              {r.label}
            </option>
          ))}
        </SelectField>
        <Field label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {request.error ? (
          <Alert tone="error" className="sm:col-span-4">
            {errorMessage(request.error)}
          </Alert>
        ) : null}
        <div className="flex justify-end sm:col-span-4">
          <Button
            type="submit"
            variant="secondary"
            disabled={value === null || reasonCode === '' || request.isPending}
          >
            {request.isPending ? 'Sending…' : 'Request discount'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PaymentRow({
  payment,
  canRequest,
  onNotice,
}: {
  payment: Payment;
  canRequest: boolean;
  onNotice: (message: string) => void;
}) {
  const { fmt } = useMoney();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<string | null>(null);

  const voidRequest = useMutation({
    mutationFn: () =>
      apiRequest(`/payments/${payment.id}/void-requests`, {
        method: 'POST',
        body: { reason },
        schema: approvalSchema,
      }),
    onSuccess: async () => {
      setReason(null);
      await queryClient.invalidateQueries({ queryKey: ['approvals'] });
      onNotice('Void requested. The payment stays as it is until someone else approves.');
    },
  });

  return (
    <>
      <tr>
        <td className="px-4 py-3 font-mono text-xs">{payment.receiptNumber}</td>
        <td className="px-4 py-3">{new Date(payment.receivedAt).toLocaleDateString()}</td>
        <td className="px-4 py-3">
          {methodLabel(payment.method)}
          {payment.reference ? (
            <span className="text-muted-foreground"> · {payment.reference}</span>
          ) : null}
        </td>
        <td className="px-4 py-3 font-medium">{fmt(payment.amount)}</td>
        <td className="px-4 py-3">
          <Badge tone={payment.status === 'posted' ? 'success' : 'danger'}>
            {payment.status === 'posted' ? 'Received' : 'Void'}
          </Badge>
        </td>
        <td className="px-4 py-3 text-right whitespace-nowrap">
          <Link
            href={`/billing/receipts/${payment.id}`}
            className="hover:bg-secondary inline-flex h-8 items-center rounded-md px-3 text-sm font-medium"
          >
            Receipt
          </Link>
          {canRequest && payment.status === 'posted' && reason === null ? (
            <Button variant="ghost" className="h-8 px-3" onClick={() => setReason('')}>
              Request void
            </Button>
          ) : null}
        </td>
      </tr>
      {reason !== null ? (
        <tr>
          <td colSpan={6} className="bg-muted/40 px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-64 flex-1">
                <Field
                  label="Why should this be voided?"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <Button
                disabled={reason.trim().length < 5 || voidRequest.isPending}
                onClick={() => voidRequest.mutate()}
              >
                {voidRequest.isPending ? 'Sending…' : 'Send request'}
              </Button>
              <Button variant="ghost" onClick={() => setReason(null)}>
                Cancel
              </Button>
            </div>
            {voidRequest.error ? (
              <Alert tone="error" className="mt-2">
                {errorMessage(voidRequest.error)}
              </Alert>
            ) : null}
            <p className="text-muted-foreground mt-2 text-xs">
              A second person has to approve it before anything changes.
            </p>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function InvoiceDetailScreen({ invoiceId }: { invoiceId: string }) {
  const { fmt } = useMoney();
  const { can } = useSession();
  const invoiceQuery = useInvoice(invoiceId);
  const paymentsQuery = useInvoicePayments(invoiceId);
  const [panel, setPanel] = useState<'payment' | 'discount' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (invoiceQuery.error) return <Alert tone="error">{errorMessage(invoiceQuery.error)}</Alert>;
  const invoice = invoiceQuery.data;
  if (!invoice) return null;

  const open = invoice.status === 'issued' || invoice.status === 'partially_paid';
  const canReceive = can('billing.receive');
  const canRequest = can('billing.request');
  const done = (message: string) => {
    setNotice(message);
    setPanel(null);
  };

  return (
    <div className="space-y-6">
      <Link href="/billing" className="text-muted-foreground text-sm hover:underline print:hidden">
        ← All invoices
      </Link>
      <SectionHeader
        title={`Invoice ${invoice.number}`}
        description={`${invoice.studentName} · ${invoice.studentNumber} · issued ${new Date(invoice.createdAt).toLocaleDateString()}`}
        action={<Badge tone={invoiceTone[invoice.status]}>{invoiceLabel(invoice.status)}</Badge>}
      />
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <table className="w-full text-sm">
          <tbody className="divide-border divide-y">
            {invoice.lines.map((line) => (
              <tr key={line.description}>
                <td className="py-2">{line.description}</td>
                <td className="py-2 text-right">{fmt(line.amount)}</td>
              </tr>
            ))}
            {invoice.discountTotal > 0 ? (
              <tr>
                <td className="py-2">Discounts</td>
                <td className="py-2 text-right">-{fmt(invoice.discountTotal)}</td>
              </tr>
            ) : null}
            <tr className="font-medium">
              <td className="py-2">Total</td>
              <td className="py-2 text-right">{fmt(invoice.total)}</td>
            </tr>
            <tr>
              <td className="py-2">Paid</td>
              <td className="py-2 text-right">{fmt(invoice.paidTotal)}</td>
            </tr>
            <tr className="text-base font-semibold">
              <td className="py-2">Balance</td>
              <td className="py-2 text-right">{fmt(invoice.balance)}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      {open && (canReceive || canRequest) && panel === null ? (
        <div className="flex flex-wrap gap-2">
          {canReceive ? (
            <Button onClick={() => setPanel('payment')}>Record a payment</Button>
          ) : null}
          {canRequest ? (
            <Button variant="secondary" onClick={() => setPanel('discount')}>
              Ask for a discount
            </Button>
          ) : null}
        </div>
      ) : null}
      {panel === 'payment' ? <PaymentForm invoice={invoice} onDone={done} /> : null}
      {panel === 'discount' ? <DiscountForm invoice={invoice} onDone={done} /> : null}
      {panel !== null ? (
        <Button variant="ghost" onClick={() => setPanel(null)}>
          Close
        </Button>
      ) : null}

      <SimpleTable head={['Instalment', 'Due', 'Amount', 'Paid', 'Status']}>
        {invoice.installments.map((i) => (
          <tr key={i.id}>
            <td className="px-4 py-3">#{i.sequence}</td>
            <td className="px-4 py-3">{formatDate(i.dueDate)}</td>
            <td className="px-4 py-3">{fmt(i.amount)}</td>
            <td className="px-4 py-3">{fmt(i.paidAmount)}</td>
            <td className="px-4 py-3">
              <Badge tone={installmentTone[i.status]}>
                {i.status.charAt(0).toUpperCase() + i.status.slice(1)}
              </Badge>
            </td>
          </tr>
        ))}
      </SimpleTable>

      <SectionHeader
        title="Payments"
        description="Every payment has a receipt. A wrong one is voided with a second person's approval, never deleted."
      />
      {paymentsQuery.error ? <Alert tone="error">{errorMessage(paymentsQuery.error)}</Alert> : null}
      <SimpleTable
        head={['Receipt', 'Date', 'Method', 'Amount', 'Status', '']}
        empty={
          !paymentsQuery.isPending && (paymentsQuery.data?.items.length ?? 0) === 0
            ? 'No payments yet.'
            : null
        }
      >
        {paymentsQuery.data?.items.map((payment) => (
          <PaymentRow
            key={`${payment.id}:${payment.version}`}
            payment={payment}
            canRequest={canRequest}
            onNotice={setNotice}
          />
        ))}
      </SimpleTable>
    </div>
  );
}
