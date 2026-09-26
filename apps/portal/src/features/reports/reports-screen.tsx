'use client';

import {
  AGING_LABELS,
  type AgingBucket,
  outstandingItemsResponseSchema,
  outstandingResponseSchema,
  REVENUE_GROUPINGS,
  type RevenueGrouping,
  revenueResponseSchema,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Card } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { SelectField } from '@emis/ui/components/select';
import { cn } from '@emis/ui/lib/cn';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { SectionHeader } from '@/components/section-header';
import { SimpleTable } from '@/components/simple-table';
import { useMoney } from '@/features/billing/money';
import { useBranches, useDepartments } from '@/features/institution/use-org-units';
import { useInstitution } from '@/features/institution/use-institution';
import { apiRequest, errorMessage } from '@/lib/api';

import { barPercent, buildQuery } from './query';

const GROUP_LABELS: Record<RevenueGrouping, string> = {
  day: 'Day',
  month: 'Month',
  branch: 'Branch',
  department: 'Department',
  program: 'Program',
  method: 'Payment method',
};

const METHODS = [
  ['', 'Any method'],
  ['cash', 'Cash'],
  ['bank_transfer', 'Bank transfer'],
  ['cheque', 'Cheque'],
] as const;

const BUCKET_TONE = {
  not_due: 'success',
  d1_30: 'warning',
  d31_60: 'warning',
  d61_90: 'danger',
  d90_plus: 'danger',
} as const;

function DownloadLink({ href, children }: { href: string; children: string }) {
  // A plain link: the browser sends the session cookie and saves the file.
  return (
    <a
      href={href}
      download
      className="border-border hover:bg-secondary inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium"
    >
      {children}
    </a>
  );
}

function Filters({
  branchId,
  departmentId,
  onBranch,
  onDepartment,
}: {
  branchId: string;
  departmentId: string;
  onBranch: (id: string) => void;
  onDepartment: (id: string) => void;
}) {
  const { term } = useInstitution();
  const branches = useBranches();
  const departments = useDepartments();
  return (
    <>
      <SelectField
        label={term('branch')}
        value={branchId}
        onChange={(e) => onBranch(e.target.value)}
      >
        <option value="">All</option>
        {branches.data?.items.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        label={term('department')}
        value={departmentId}
        onChange={(e) => onDepartment(e.target.value)}
      >
        <option value="">All</option>
        {departments.data?.items.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </SelectField>
    </>
  );
}

function RevenueReport() {
  const { fmt } = useMoney();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [groupBy, setGroupBy] = useState<RevenueGrouping>('day');
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [method, setMethod] = useState('');

  const query = buildQuery({ from, to, groupBy, branchId, departmentId, method });
  const report = useQuery({
    queryKey: ['reports', 'revenue', query],
    queryFn: () => apiRequest(`/reports/revenue${query}`, { schema: revenueResponseSchema }),
    placeholderData: keepPreviousData,
  });
  const data = report.data;
  const max = Math.max(0, ...(data?.rows.map((r) => r.amount) ?? []));

  return (
    <div className="space-y-4">
      <Card className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Field label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <SelectField
          label="Group by"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as RevenueGrouping)}
        >
          {REVENUE_GROUPINGS.map((g) => (
            <option key={g} value={g}>
              {GROUP_LABELS[g]}
            </option>
          ))}
        </SelectField>
        <Filters
          branchId={branchId}
          departmentId={departmentId}
          onBranch={setBranchId}
          onDepartment={setDepartmentId}
        />
        <SelectField label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>
          {METHODS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
      </Card>

      {report.error ? <Alert tone="error">{errorMessage(report.error)}</Alert> : null}

      {data ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-muted-foreground text-sm">
                Collected {data.from} to {data.to}
              </p>
              <p className="text-3xl font-semibold tracking-tight">{fmt(data.totals.amount)}</p>
              <p className="text-muted-foreground text-sm">
                {data.totals.count} payment{data.totals.count === 1 ? '' : 's'}
                {data.totals.voidedCount > 0
                  ? ` · ${data.totals.voidedCount} voided (${fmt(data.totals.voidedAmount)}, not counted)`
                  : ''}
              </p>
            </div>
            <DownloadLink href={`/api/v1/reports/revenue.csv${query}`}>Download CSV</DownloadLink>
          </div>
          <SimpleTable
            head={[GROUP_LABELS[data.groupBy], 'Payments', 'Amount', '']}
            empty={data.rows.length === 0 ? 'No payments in this period.' : null}
          >
            {data.rows.map((row) => (
              <tr key={row.key}>
                <td className="px-4 py-3 font-medium">{row.label}</td>
                <td className="px-4 py-3">{row.count}</td>
                <td className="px-4 py-3 whitespace-nowrap">{fmt(row.amount)}</td>
                <td className="w-1/3 px-4 py-3">
                  <div className="bg-muted h-2 rounded-full" aria-hidden="true">
                    <div
                      className="bg-primary h-2 rounded-full"
                      style={{ width: `${barPercent(row.amount, max)}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </SimpleTable>
        </>
      ) : null}
    </div>
  );
}

function OutstandingReport() {
  const { fmt } = useMoney();
  const [asOf, setAsOf] = useState('');
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [bucket, setBucket] = useState<AgingBucket | ''>('');

  const filters = { asOf, branchId, departmentId };
  const summary = useQuery({
    queryKey: ['reports', 'outstanding', filters],
    queryFn: () =>
      apiRequest(`/reports/outstanding${buildQuery(filters)}`, {
        schema: outstandingResponseSchema,
      }),
    placeholderData: keepPreviousData,
  });
  const items = useInfiniteQuery({
    queryKey: ['reports', 'outstanding-items', filters, bucket],
    queryFn: ({ pageParam }) =>
      apiRequest(
        `/reports/outstanding/items${buildQuery({ ...filters, bucket, limit: 25, cursor: pageParam })}`,
        { schema: outstandingItemsResponseSchema },
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const rows = items.data?.pages.flatMap((p) => p.items) ?? [];
  const data = summary.data;
  const error = summary.error ?? items.error;

  return (
    <div className="space-y-4">
      <Card className="grid gap-4 sm:grid-cols-3">
        <Field
          label="As of"
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
          hint="Leave empty for today."
        />
        <Filters
          branchId={branchId}
          departmentId={departmentId}
          onBranch={setBranchId}
          onDepartment={setDepartmentId}
        />
      </Card>

      {error ? <Alert tone="error">{errorMessage(error)}</Alert> : null}

      {data ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-muted-foreground text-sm">Still to collect as of {data.asOf}</p>
              <p className="text-3xl font-semibold tracking-tight">{fmt(data.totals.amount)}</p>
              <p className="text-muted-foreground text-sm">
                {fmt(data.totals.overdueAmount)} overdue across {data.totals.overdueCount}{' '}
                instalment{data.totals.overdueCount === 1 ? '' : 's'}
              </p>
            </div>
            <DownloadLink href={`/api/v1/reports/outstanding.csv${buildQuery(filters)}`}>
              Download CSV
            </DownloadLink>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {data.buckets.map((b) => {
              const active = bucket === b.bucket;
              return (
                <button
                  key={b.bucket}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setBucket(active ? '' : b.bucket)}
                  className={cn(
                    'border-border hover:border-primary rounded-xl border p-4 text-left transition-colors',
                    active && 'border-primary bg-primary/5',
                  )}
                >
                  <Badge tone={BUCKET_TONE[b.bucket]}>{AGING_LABELS[b.bucket]}</Badge>
                  <p className="mt-2 text-lg font-semibold">{fmt(b.amount)}</p>
                  <p className="text-muted-foreground text-sm">
                    {b.count} instalment{b.count === 1 ? '' : 's'}
                  </p>
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      <SimpleTable
        head={['Student', 'Invoice', 'Due', 'Age', 'Owed']}
        empty={!items.isPending && rows.length === 0 ? 'Nothing outstanding here.' : null}
      >
        {rows.map((item) => (
          <tr key={item.installmentId}>
            <td className="px-4 py-3">
              <Link href={`/students/${item.studentId}`} className="font-medium hover:underline">
                {item.studentName}
              </Link>
              <div className="text-muted-foreground font-mono text-xs">{item.studentNumber}</div>
            </td>
            <td className="px-4 py-3">
              <Link href={`/billing/invoices/${item.invoiceId}`} className="hover:underline">
                {item.invoiceNumber}
              </Link>
              <div className="text-muted-foreground text-xs">Instalment {item.sequence}</div>
            </td>
            <td className="px-4 py-3 whitespace-nowrap">{item.dueDate}</td>
            <td className="px-4 py-3">
              <Badge tone={BUCKET_TONE[item.bucket]}>
                {item.daysOverdue > 0 ? `${item.daysOverdue} days` : 'Not due'}
              </Badge>
            </td>
            <td className="px-4 py-3 whitespace-nowrap">{fmt(item.owed)}</td>
          </tr>
        ))}
      </SimpleTable>
      {items.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={items.isFetchingNextPage}
          onClick={() => void items.fetchNextPage()}
        >
          {items.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}

export function ReportsScreen() {
  const [tab, setTab] = useState<'revenue' | 'outstanding'>('revenue');
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Reports"
        description="What has been collected and what is still owed. Figures come straight from recorded payments and invoices, and every CSV download is logged."
      />
      <div role="tablist" aria-label="Report" className="border-border flex gap-1 border-b">
        {(
          [
            ['revenue', 'Revenue'],
            ['outstanding', 'Outstanding'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium',
              tab === key
                ? 'border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'revenue' ? <RevenueReport /> : <OutstandingReport />}
    </div>
  );
}
