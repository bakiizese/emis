'use client';

import { APPLICATION_STATUSES, applicationListResponseSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Input } from '@emis/ui/components/input';
import { SelectField } from '@emis/ui/components/select';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';

import { SectionHeader } from '@/components/section-header';
import { SimpleTable } from '@/components/simple-table';
import { useInstitution } from '@/features/institution/use-institution';
import { useBranches } from '@/features/institution/use-org-units';
import { ApplicationStatusBadge, applicationStatusLabel } from '@/features/people/status-badges';
import { useSession } from '@/features/session/use-session';
import { apiRequest, errorMessage } from '@/lib/api';

import { ApplicationForm } from './application-form';
import { useCourseOptions } from './use-course-options';

export function ApplicationsScreen() {
  const router = useRouter();
  const { term } = useInstitution();
  const { can } = useSession();
  const branches = useBranches();
  const courses = useCourseOptions();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [stage, setStage] = useState<'open' | 'closed' | ''>('open');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);

  const applications = useInfiniteQuery({
    queryKey: ['applications', q, stage, status],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        limit: '25',
        ...(q ? { q } : {}),
        ...(stage ? { stage } : {}),
        ...(status ? { status } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      });
      return apiRequest(`/applications?${params.toString()}`, {
        schema: applicationListResponseSchema,
      });
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

  const rows = applications.data?.pages.flatMap((page) => page.items) ?? [];
  const branchName = (id: string) => branches.data?.items.find((b) => b.id === id)?.name ?? '—';
  const courseName = (id: string | null) =>
    id ? (courses.options.find((c) => c.id === id)?.label ?? '—') : '—';

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Admissions"
        description="People who want to study here, from first contact to registration. Open one to record a placement result, make an offer or register them."
        action={
          can('admissions.manage') && !creating ? (
            <Button onClick={() => setCreating(true)}>New applicant</Button>
          ) : null
        }
      />
      {creating ? (
        <ApplicationForm
          onDone={(id) => {
            setCreating(false);
            if (id) router.push(`/admissions/${id}`);
          }}
        />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_12rem]">
        <Input
          type="search"
          placeholder="Search by name, phone or reference"
          aria-label="Search applications"
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
          <option value="open">Still open</option>
          <option value="closed">Finished</option>
          <option value="">Everything</option>
        </SelectField>
        <SelectField
          label="Stage"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">Any stage</option>
          {APPLICATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {applicationStatusLabel(s)}
            </option>
          ))}
        </SelectField>
      </div>
      {applications.error ? <Alert tone="error">{errorMessage(applications.error)}</Alert> : null}
      <SimpleTable
        head={['Applicant', 'Reference', 'Wants to study', term('branch'), 'Stage', 'Received']}
        empty={!applications.isPending && rows.length === 0 ? 'Nothing here.' : null}
      >
        {rows.map((a) => (
          <tr key={a.id}>
            <td className="px-4 py-3">
              <Link href={`/admissions/${a.id}`} className="font-medium hover:underline">
                {a.givenName} {a.fatherName} {a.grandfatherName ?? ''}
              </Link>
              <div className="text-muted-foreground text-xs">{a.phone}</div>
            </td>
            <td className="px-4 py-3 font-mono text-xs">{a.reference}</td>
            <td className="px-4 py-3">{courseName(a.desiredCourseId)}</td>
            <td className="px-4 py-3">{branchName(a.branchId)}</td>
            <td className="px-4 py-3">
              <ApplicationStatusBadge status={a.status} />
            </td>
            <td className="text-muted-foreground px-4 py-3">
              {new Date(a.createdAt).toLocaleDateString()}
            </td>
          </tr>
        ))}
      </SimpleTable>
      {applications.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={applications.isFetchingNextPage}
          onClick={() => void applications.fetchNextPage()}
        >
          {applications.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}
