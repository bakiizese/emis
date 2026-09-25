'use client';

import { INVOICE_STATUSES, invoiceListResponseSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Input } from '@emis/ui/components/input';
import { SelectField } from '@emis/ui/components/select';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';

import { SectionHeader } from '@/components/section-header';
import { SimpleTable } from '@/components/simple-table';
import { formatDate } from '@/features/academics/use-catalog';
import { apiRequest, errorMessage } from '@/lib/api';

import { useMoney } from './money';

export const invoiceTone = {
  issued: 'info',
  partially_paid: 'warning',
  paid: 'success',
  void: 'neutral',
} as const;
export const invoiceLabel = (status: string) => {
  const text = status.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export function InvoicesScreen() {
  const { fmt } = useMoney();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [stage, setStage] = useState<'unpaid' | 'settled' | ''>('unpaid');
  const [status, setStatus] = useState('');

  const invoices = useInfiniteQuery({
    queryKey: ['invoices', 'list', q, stage, status],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        limit: '25',
        ...(q ? { q } : {}),
        ...(stage ? { stage } : {}),
        ...(status ? { status } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      });
      return apiRequest(`/invoices?${params.toString()}`, { schema: invoiceListResponseSchema });
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const rows = invoices.data?.pages.flatMap((page) => page.items) ?? [];

  /** The soonest instalment still unpaid, so the list shows what to chase first. */
  const nextDue = (invoice: (typeof rows)[number]) =>
    invoice.installments.find((i) => i.status !== 'paid');

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Invoices"
        description="What students owe. Open one to record a payment, print a receipt, or ask for a discount. Create an invoice from a student's page once they are enrolled."
      />
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_12rem]">
        <Input
          type="search"
          placeholder="Search by invoice number, student name or number"
          aria-label="Search invoices"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SelectField
          label="Show"
          value={stage}
          onChange={(event) => {
            setStage(event.target.value as typeof stage);
            setStatus('');
          }}
        >
          <option value="unpaid">Unpaid</option>
          <option value="settled">Paid or void</option>
          <option value="">Everything</option>
        </SelectField>
        <SelectField
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">Any</option>
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {invoiceLabel(s)}
            </option>
          ))}
        </SelectField>
      </div>
      {invoices.error ? <Alert tone="error">{errorMessage(invoices.error)}</Alert> : null}
      <SimpleTable
        head={['Invoice', 'Student', 'Total', 'Balance', 'Next due', 'Status']}
        empty={!invoices.isPending && rows.length === 0 ? 'Nothing here.' : null}
      >
        {rows.map((invoice) => {
          const due = nextDue(invoice);
          return (
            <tr key={invoice.id}>
              <td className="px-4 py-3">
                <Link
                  href={`/billing/invoices/${invoice.id}`}
                  className="font-mono text-xs font-medium hover:underline"
                >
                  {invoice.number}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Link href={`/students/${invoice.studentId}`} className="hover:underline">
                  {invoice.studentName}
                </Link>
                <div className="text-muted-foreground font-mono text-xs">
                  {invoice.studentNumber}
                </div>
              </td>
              <td className="px-4 py-3">{fmt(invoice.total)}</td>
              <td className="px-4 py-3 font-medium">{fmt(invoice.balance)}</td>
              <td className="px-4 py-3">
                {due && invoice.status !== 'void' ? (
                  <span
                    className={
                      due.status === 'overdue'
                        ? 'text-red-700 dark:text-red-300'
                        : 'text-muted-foreground'
                    }
                  >
                    {formatDate(due.dueDate)}
                    {due.status === 'overdue' ? ' · overdue' : ''}
                  </span>
                ) : (
                  '—'
                )}
              </td>
              <td className="px-4 py-3">
                <Badge tone={invoiceTone[invoice.status]}>{invoiceLabel(invoice.status)}</Badge>
              </td>
            </tr>
          );
        })}
      </SimpleTable>
      {invoices.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={invoices.isFetchingNextPage}
          onClick={() => void invoices.fetchNextPage()}
        >
          {invoices.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}
