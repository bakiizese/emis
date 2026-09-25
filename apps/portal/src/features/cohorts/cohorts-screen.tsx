'use client';

import { COHORT_STATUSES, cohortListResponseSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { SelectField } from '@emis/ui/components/select';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { SectionHeader } from '@/components/section-header';
import { SimpleTable } from '@/components/simple-table';
import { formatDate, useRooms, useShifts } from '@/features/academics/use-catalog';
import { useCourseOptions } from '@/features/admissions/use-course-options';
import { useInstitution } from '@/features/institution/use-institution';
import { useSession } from '@/features/session/use-session';
import { apiRequest, errorMessage } from '@/lib/api';

import { CohortForm } from './cohort-form';

export const cohortStatusTone = {
  planned: 'neutral',
  open: 'success',
  running: 'info',
  completed: 'neutral',
  cancelled: 'danger',
} as const;

export const cohortStatusLabel = (status: string) =>
  status.charAt(0).toUpperCase() + status.slice(1);

export function CohortsScreen() {
  const router = useRouter();
  const { term } = useInstitution();
  const { can } = useSession();
  const courses = useCourseOptions();
  const shifts = useShifts();
  const rooms = useRooms();
  const [stage, setStage] = useState<'live' | 'finished' | ''>('live');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);

  const cohorts = useInfiniteQuery({
    queryKey: ['cohorts', 'list', stage, status],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        limit: '25',
        ...(stage ? { stage } : {}),
        ...(status ? { status } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      });
      return apiRequest(`/cohorts?${params.toString()}`, { schema: cohortListResponseSchema });
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

  const rows = cohorts.data?.pages.flatMap((page) => page.items) ?? [];
  const courseName = (id: string) => courses.options.find((c) => c.id === id)?.label ?? '—';
  const shiftName = (id: string) => shifts.data?.items.find((s) => s.id === id)?.name ?? '—';
  const roomName = (id: string) => rooms.data?.items.find((r) => r.id === id)?.name ?? '—';

  return (
    <div className="space-y-6">
      <SectionHeader
        title={term('cohort', true)}
        description={`Scheduled classes: a ${term('course').toLowerCase()} in a ${term('shift').toLowerCase()} and room, with an ${term('instructor').toLowerCase()}. Open one to enroll students and manage its waitlist.`}
        action={
          can('cohorts.manage') && !creating ? (
            <Button onClick={() => setCreating(true)}>New {term('cohort').toLowerCase()}</Button>
          ) : null
        }
      />
      {creating ? (
        <CohortForm
          editing={null}
          onDone={(cohort) => {
            setCreating(false);
            if (cohort) router.push(`/cohorts/${cohort.id}`);
          }}
        />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[12rem_12rem]">
        <SelectField
          label="Show"
          value={stage}
          onChange={(event) => {
            setStage(event.target.value as typeof stage);
            setStatus('');
          }}
        >
          <option value="live">Current and upcoming</option>
          <option value="finished">Finished</option>
          <option value="">Everything</option>
        </SelectField>
        <SelectField
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">Any status</option>
          {COHORT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {cohortStatusLabel(s)}
            </option>
          ))}
        </SelectField>
      </div>
      {cohorts.error ? <Alert tone="error">{errorMessage(cohorts.error)}</Alert> : null}
      <SimpleTable
        head={[term('cohort'), term('shift'), 'Room', 'Dates', 'Seats', 'Status']}
        empty={!cohorts.isPending && rows.length === 0 ? 'Nothing here.' : null}
      >
        {rows.map((cohort) => (
          <tr key={cohort.id}>
            <td className="px-4 py-3">
              <Link href={`/cohorts/${cohort.id}`} className="font-medium hover:underline">
                {cohort.name}
              </Link>
              <div className="text-muted-foreground text-xs">{courseName(cohort.courseId)}</div>
            </td>
            <td className="px-4 py-3">{shiftName(cohort.shiftId)}</td>
            <td className="px-4 py-3">{roomName(cohort.roomId)}</td>
            <td className="text-muted-foreground px-4 py-3">
              {formatDate(cohort.startDate)} → {formatDate(cohort.endDate)}
            </td>
            <td className="px-4 py-3">
              {cohort.enrolledCount}/{cohort.capacity}
              {cohort.waitlistCount > 0 ? (
                <span className="text-muted-foreground"> · {cohort.waitlistCount} waiting</span>
              ) : null}
            </td>
            <td className="px-4 py-3">
              <Badge tone={cohortStatusTone[cohort.status]}>
                {cohortStatusLabel(cohort.status)}
              </Badge>
            </td>
          </tr>
        ))}
      </SimpleTable>
      {cohorts.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={cohorts.isFetchingNextPage}
          onClick={() => void cohorts.fetchNextPage()}
        >
          {cohorts.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}
