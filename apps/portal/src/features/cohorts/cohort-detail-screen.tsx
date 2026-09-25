'use client';

import {
  type Cohort,
  type Enrollment,
  enrollResponseSchema,
  cohortSchema,
  enrollmentSchema,
  studentListResponseSchema,
  withdrawResponseSchema,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { Input } from '@emis/ui/components/input';
import { SelectField } from '@emis/ui/components/select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';

import { SectionHeader } from '@/components/section-header';
import { SimpleTable } from '@/components/simple-table';
import { formatDate, formatDateTime, useRooms, useShifts } from '@/features/academics/use-catalog';
import { useCourseOptions } from '@/features/admissions/use-course-options';
import { useInstitution } from '@/features/institution/use-institution';
import { useDescriptorOptions } from '@/features/people/use-lists';
import { useSession } from '@/features/session/use-session';
import { apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

import { CohortForm } from './cohort-form';
import { cohortStatusLabel, cohortStatusTone } from './cohorts-screen';
import {
  ACTION_TARGETS,
  COHORT_ACTIONS,
  useCohort,
  useCohortSessions,
  useInstructors,
  useRoster,
} from './use-cohorts';

const enrollmentTone = {
  active: 'success',
  waitlisted: 'warning',
  completed: 'info',
  failed: 'danger',
  withdrawn: 'neutral',
} as const;

function useRefresh(cohortId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['enrollments'] });
    await queryClient.invalidateQueries({ queryKey: ['cohorts'] });
    await queryClient.invalidateQueries({ queryKey: ['cohorts', 'one', cohortId] });
  };
}

/** Find a student by name, number or phone and enroll them; shows whether they got a seat or a waitlist place. */
function EnrollPanel({ cohort }: { cohort: Cohort }) {
  const { term } = useInstitution();
  const refresh = useRefresh(cohort.id);
  const idempotency = useIdempotencyKey();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [message, setMessage] = useState<{ tone: 'success' | 'info'; text: string } | null>(null);

  const found = useQuery({
    queryKey: ['students', 'picker', q],
    queryFn: () =>
      apiRequest(`/students?q=${encodeURIComponent(q)}&status=active&limit=8`, {
        schema: studentListResponseSchema,
      }),
    enabled: q.length >= 2,
  });

  const enroll = useMutation({
    mutationFn: (studentId: string) => {
      const body = { studentId, cohortId: cohort.id };
      return apiRequest('/enrollments', {
        method: 'POST',
        body,
        schema: enrollResponseSchema,
        idempotencyKey: idempotency.keyFor(body),
      });
    },
    onSuccess: async (result) => {
      idempotency.reset();
      setMessage(
        result.outcome === 'enrolled'
          ? { tone: 'success', text: `${result.enrollment.studentName} is enrolled.` }
          : {
              tone: 'info',
              text: `${cohort.name} is full. ${result.enrollment.studentName} is number ${result.enrollment.waitlistPosition} on the waitlist.`,
            },
      );
      await refresh();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Enroll a {term('student').toLowerCase()}</CardTitle>
      </CardHeader>
      <div className="space-y-3">
        <Input
          type="search"
          placeholder="Search by name, number or phone"
          aria-label="Find a student to enroll"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setMessage(null);
          }}
        />
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
        {enroll.error ? <Alert tone="error">{errorMessage(enroll.error)}</Alert> : null}
        {found.data?.items.length === 0 ? (
          <p className="text-muted-foreground text-sm">No active student matches that.</p>
        ) : null}
        <ul className="divide-border divide-y">
          {found.data?.items.map((student) => (
            <li key={student.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <span className="font-medium">
                  {student.givenName} {student.fatherName} {student.grandfatherName ?? ''}
                </span>
                <div className="text-muted-foreground text-xs">
                  {student.studentNumber} · {student.phone}
                </div>
              </div>
              <Button
                className="h-8 px-3"
                disabled={enroll.isPending}
                onClick={() => enroll.mutate(student.id)}
              >
                {cohort.seatsLeft > 0 ? 'Enroll' : 'Add to waitlist'}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function EnrollmentRow({
  enrollment,
  cohort,
  canManage,
  canRecord,
  onNotice,
}: {
  enrollment: Enrollment;
  cohort: Cohort;
  canManage: boolean;
  canRecord: boolean;
  onNotice: (message: string) => void;
}) {
  const reasons = useDescriptorOptions('withdrawal_reason');
  const refresh = useRefresh(cohort.id);
  const [mode, setMode] = useState<'withdraw' | 'result' | null>(null);
  const [reason, setReason] = useState('');
  const [score, setScore] = useState('');
  const [attendance, setAttendance] = useState('');

  const withdraw = useMutation({
    mutationFn: () =>
      apiRequest(`/enrollments/${enrollment.id}/withdraw`, {
        method: 'POST',
        body: { reasonCode: reason },
        schema: withdrawResponseSchema,
        ifMatch: enrollment.version,
      }),
    onSuccess: async (result) => {
      if (result.promoted) onNotice(`${result.promoted.studentName} moved up from the waitlist.`);
      setMode(null);
      await refresh();
    },
  });
  const record = useMutation({
    mutationFn: () =>
      apiRequest(`/enrollments/${enrollment.id}/result`, {
        method: 'POST',
        body: {
          score: score === '' ? null : Number(score),
          attendancePercent: attendance === '' ? null : Number(attendance),
        },
        schema: enrollmentSchema,
        ifMatch: enrollment.version,
      }),
    onSuccess: async () => {
      setMode(null);
      await refresh();
    },
  });
  const error = withdraw.error ?? record.error;
  const live = enrollment.status === 'active' || enrollment.status === 'waitlisted';

  return (
    <>
      <tr>
        <td className="px-4 py-3">
          {enrollment.waitlistPosition ? (
            <span className="text-muted-foreground mr-2 font-mono text-xs">
              #{enrollment.waitlistPosition}
            </span>
          ) : null}
          <Link href={`/students/${enrollment.studentId}`} className="font-medium hover:underline">
            {enrollment.studentName}
          </Link>
          <div className="text-muted-foreground font-mono text-xs">{enrollment.studentNumber}</div>
        </td>
        <td className="px-4 py-3">
          <Badge tone={enrollmentTone[enrollment.status]}>
            {cohortStatusLabel(enrollment.status)}
          </Badge>
        </td>
        <td className="text-muted-foreground px-4 py-3">
          {enrollment.completedAt
            ? `${enrollment.score ?? '—'}% score · ${enrollment.attendancePercent ?? '—'}% attendance`
            : enrollment.withdrawnAt
              ? `Left ${formatDateTime(enrollment.withdrawnAt)}`
              : '—'}
        </td>
        <td className="px-4 py-3 text-right whitespace-nowrap">
          {mode === null && live && canManage ? (
            <Button variant="ghost" className="h-8 px-3" onClick={() => setMode('withdraw')}>
              Withdraw
            </Button>
          ) : null}
          {mode === null && enrollment.status === 'active' && canRecord ? (
            <Button variant="ghost" className="h-8 px-3" onClick={() => setMode('result')}>
              Record result
            </Button>
          ) : null}
        </td>
      </tr>
      {mode !== null || error ? (
        <tr>
          <td colSpan={4} className="bg-muted/40 px-4 py-3">
            {error ? <Alert tone="error">{errorMessage(error)}</Alert> : null}
            {mode === 'withdraw' ? (
              <div className="flex flex-wrap items-end gap-3">
                <SelectField
                  label="Reason"
                  className="min-w-48"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {reasons.data?.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </SelectField>
                <Button
                  disabled={reason === '' || withdraw.isPending}
                  onClick={() => withdraw.mutate()}
                >
                  {withdraw.isPending ? 'Saving…' : 'Confirm withdrawal'}
                </Button>
                <Button variant="ghost" onClick={() => setMode(null)}>
                  Cancel
                </Button>
              </div>
            ) : null}
            {mode === 'result' ? (
              <div className="flex flex-wrap items-end gap-3">
                <Field
                  label="Score (%)"
                  type="number"
                  step="any"
                  min={0}
                  max={100}
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                />
                <Field
                  label="Attendance (%)"
                  type="number"
                  step="any"
                  min={0}
                  max={100}
                  value={attendance}
                  onChange={(e) => setAttendance(e.target.value)}
                />
                <Button disabled={record.isPending} onClick={() => record.mutate()}>
                  {record.isPending ? 'Saving…' : 'Save result'}
                </Button>
                <Button variant="ghost" onClick={() => setMode(null)}>
                  Cancel
                </Button>
                <p className="text-muted-foreground w-full text-xs">
                  The course&apos;s completion rules decide whether this passes or fails.
                </p>
              </div>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function CohortDetailScreen({ cohortId }: { cohortId: string }) {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const { can } = useSession();
  const courses = useCourseOptions();
  const shifts = useShifts();
  const rooms = useRooms();
  const instructors = useInstructors();
  const cohortQuery = useCohort(cohortId);
  const roster = useRoster(cohortId);
  const [editing, setEditing] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const sessions = useCohortSessions(cohortId, showSessions);

  const cohort = cohortQuery.data;
  const setStatus = useMutation({
    mutationFn: (status: string) =>
      apiRequest(`/cohorts/${cohortId}/status`, {
        method: 'POST',
        body: { status },
        schema: cohortSchema,
        ifMatch: cohort?.version,
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['cohorts', 'one', cohortId], updated);
      await queryClient.invalidateQueries({ queryKey: ['cohorts'] });
    },
  });

  if (cohortQuery.error) return <Alert tone="error">{errorMessage(cohortQuery.error)}</Alert>;
  if (!cohort) return null;

  const canManage = can('cohorts.manage');
  const canEnroll = can('enrollments.manage');
  const enrolling = cohort.status === 'open' || cohort.status === 'running';
  const actions = COHORT_ACTIONS[cohort.status];
  const targets = ACTION_TARGETS[cohort.status];
  const items = roster.data?.items ?? [];
  const order = { active: 0, waitlisted: 1, completed: 2, failed: 2, withdrawn: 3 } as const;
  const sorted = [...items].sort(
    (a, b) =>
      order[a.status] - order[b.status] ||
      (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0) ||
      a.studentName.localeCompare(b.studentName),
  );
  const instructorName = instructors.data?.items.find(
    (i) => i.id === cohort.instructorId,
  )?.displayName;

  return (
    <div className="space-y-6">
      <Link href="/cohorts" className="text-muted-foreground text-sm hover:underline">
        ← All {term('cohort', true).toLowerCase()}
      </Link>
      <SectionHeader
        title={cohort.name}
        description={`${courses.options.find((c) => c.id === cohort.courseId)?.label ?? ''} · ${formatDate(cohort.startDate)} → ${formatDate(cohort.endDate)}`}
        action={
          <Badge tone={cohortStatusTone[cohort.status]}>{cohortStatusLabel(cohort.status)}</Badge>
        }
      />

      {setStatus.error ? <Alert tone="error">{errorMessage(setStatus.error)}</Alert> : null}
      {canManage && (actions.length > 0 || cohort.status !== 'cancelled') ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((action, i) => (
            <Button
              key={action.label}
              variant={action.variant}
              disabled={setStatus.isPending}
              onClick={() => {
                if (action.confirm && !window.confirm(action.confirm)) return;
                const target = targets[i];
                if (target) setStatus.mutate(target);
              }}
            >
              {action.label}
            </Button>
          ))}
          {!editing && cohort.status !== 'completed' && cohort.status !== 'cancelled' ? (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <CohortForm key={cohort.version} editing={cohort} onDone={() => setEditing(false)} />
      ) : null}

      <Card>
        <dl className="grid grid-cols-[9rem_1fr] gap-x-6 gap-y-2 text-sm sm:grid-cols-[9rem_1fr_9rem_1fr]">
          <dt className="text-muted-foreground">{term('shift')}</dt>
          <dd>{shifts.data?.items.find((s) => s.id === cohort.shiftId)?.name ?? '—'}</dd>
          <dt className="text-muted-foreground">Room</dt>
          <dd>{rooms.data?.items.find((r) => r.id === cohort.roomId)?.name ?? '—'}</dd>
          <dt className="text-muted-foreground">{term('instructor')}</dt>
          <dd>{instructorName ?? 'Not assigned'}</dd>
          <dt className="text-muted-foreground">Seats</dt>
          <dd>
            {cohort.enrolledCount} of {cohort.capacity} taken
            {cohort.waitlistCount > 0 ? ` · ${cohort.waitlistCount} waiting` : ''}
          </dd>
        </dl>
        <div className="mt-4">
          <Button
            variant="ghost"
            className="h-8 px-3"
            onClick={() => setShowSessions(!showSessions)}
          >
            {showSessions ? 'Hide timetable' : `Show timetable (${cohort.sessionCount} classes)`}
          </Button>
          {showSessions ? (
            <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {sessions.data?.items.map((s) => (
                <li key={s.id}>
                  {formatDate(s.sessionDate)} ·{' '}
                  {new Date(s.startsAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  –
                  {new Date(s.endsAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Card>

      {canEnroll && enrolling ? <EnrollPanel cohort={cohort} /> : null}
      {canEnroll && !enrolling && cohort.status === 'planned' ? (
        <Alert>Open this cohort for enrollment before adding students.</Alert>
      ) : null}

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {roster.error ? <Alert tone="error">{errorMessage(roster.error)}</Alert> : null}
      <SimpleTable
        head={[term('student'), 'Status', 'Result', '']}
        empty={!roster.isPending && sorted.length === 0 ? 'No students yet.' : null}
      >
        {sorted.map((enrollment) => (
          <EnrollmentRow
            key={`${enrollment.id}:${enrollment.version}`}
            enrollment={enrollment}
            cohort={cohort}
            canManage={canEnroll}
            canRecord={can('results.record')}
            onNotice={setNotice}
          />
        ))}
      </SimpleTable>
    </div>
  );
}
