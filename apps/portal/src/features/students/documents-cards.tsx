'use client';

import {
  certificateListResponseSchema,
  certificateSchema,
  studentCardSchema,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { formatDate } from '@/features/academics/use-catalog';
import { useStudentEnrollments } from '@/features/cohorts/use-cohorts';
import { useInstitution } from '@/features/institution/use-institution';
import { useSession } from '@/features/session/use-session';
import { apiRequest, errorMessage } from '@/lib/api';

const linkClass =
  'hover:bg-secondary inline-flex h-8 items-center rounded-md px-3 text-sm font-medium';

/** The student's ID card: issue one (an earlier card stops working) and open it as a PDF to print. */
export function IdCardCard({ studentId }: { studentId: string }) {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const card = useQuery({
    queryKey: ['student-card', studentId],
    queryFn: () =>
      apiRequest(`/students/${studentId}/id-card`, { schema: studentCardSchema.nullable() }),
  });
  const issue = useMutation({
    mutationFn: () =>
      apiRequest(`/students/${studentId}/id-card`, { method: 'POST', schema: studentCardSchema }),
    onSuccess: (created) => queryClient.setQueryData(['student-card', studentId], created),
  });
  const tone = { active: 'success', expired: 'warning', revoked: 'danger' } as const;
  const c = card.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">ID card</CardTitle>
      </CardHeader>
      {card.error ? <Alert tone="error">{errorMessage(card.error)}</Alert> : null}
      {issue.error ? <Alert tone="error">{errorMessage(issue.error)}</Alert> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        {c ? (
          <div className="space-y-1">
            <Badge tone={tone[c.status]}>
              {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
            </Badge>
            <p className="text-muted-foreground">
              Valid {formatDate(c.validFrom)} to {formatDate(c.validUntil)}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">No card issued yet.</p>
        )}
        <div className="flex gap-2">
          {c ? (
            <a
              href={`/api/v1/students/${studentId}/id-card/pdf`}
              target="_blank"
              rel="noreferrer"
              className={linkClass}
            >
              Open PDF
            </a>
          ) : null}
          {can('students.manage') ? (
            <Button
              variant={c ? 'ghost' : 'primary'}
              className="h-8 px-3"
              disabled={issue.isPending}
              onClick={() => {
                if (c && !window.confirm('Issue a new card? The current one will stop working.'))
                  return;
                issue.mutate();
              }}
            >
              {c ? 'Issue a replacement' : 'Issue card'}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/** Certificates the student holds, and a button on each completed class to issue one. */
export function CertificatesCard({ studentId }: { studentId: string }) {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const { term } = useInstitution();
  const enrollments = useStudentEnrollments(studentId, true);
  const certs = useQuery({
    queryKey: ['certificates', 'student', studentId],
    queryFn: () =>
      apiRequest(`/certificates?studentId=${studentId}&limit=100`, {
        schema: certificateListResponseSchema,
      }),
  });
  const [revoking, setRevoking] = useState<{ id: string; version: number; reason: string } | null>(
    null,
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['certificates'] });
  const issue = useMutation({
    mutationFn: (enrollmentId: string) =>
      apiRequest(`/enrollments/${enrollmentId}/certificate`, {
        method: 'POST',
        schema: certificateSchema,
      }),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (r: { id: string; version: number; reason: string }) =>
      apiRequest(`/certificates/${r.id}/revoke`, {
        method: 'POST',
        body: { reason: r.reason },
        schema: certificateSchema,
        ifMatch: r.version,
      }),
    onSuccess: async () => {
      setRevoking(null);
      await refresh();
    },
  });

  const items = certs.data?.items ?? [];
  const live = new Set(items.filter((c) => c.status === 'issued').map((c) => c.enrollmentId));
  const eligible = (enrollments.data?.items ?? []).filter(
    (e) => e.status === 'completed' && !live.has(e.id),
  );
  const error = issue.error ?? revoke.error ?? certs.error;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Certificates</CardTitle>
      </CardHeader>
      {error ? <Alert tone="error">{errorMessage(error)}</Alert> : null}
      {certs.data && items.length === 0 && eligible.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          None yet. A certificate can be issued once a student completes a{' '}
          {term('course').toLowerCase()}.
        </p>
      ) : null}
      <ul className="divide-border divide-y">
        {items.map((c) => (
          <li key={c.id} className="space-y-2 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium">{c.courseName}</span>
                <div className="text-muted-foreground font-mono text-xs">
                  {c.serial} · completed {formatDate(c.completedOn)}
                  {c.revokedReason ? ` · revoked: ${c.revokedReason}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Badge tone={c.status === 'issued' ? 'success' : 'danger'}>
                  {c.status === 'issued' ? 'Valid' : 'Revoked'}
                </Badge>
                <a
                  href={`/api/v1/certificates/${c.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className={linkClass}
                >
                  Open PDF
                </a>
                {c.status === 'issued' && can('certificates.revoke') && revoking?.id !== c.id ? (
                  <Button
                    variant="ghost"
                    className="h-8 px-3"
                    onClick={() => setRevoking({ id: c.id, version: c.version, reason: '' })}
                  >
                    Revoke
                  </Button>
                ) : null}
              </div>
            </div>
            {revoking?.id === c.id ? (
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-64 flex-1">
                  <Field
                    label="Why is it being revoked?"
                    value={revoking.reason}
                    onChange={(e) => setRevoking({ ...revoking, reason: e.target.value })}
                  />
                </div>
                <Button
                  disabled={revoking.reason.trim().length < 5 || revoke.isPending}
                  onClick={() => revoke.mutate(revoking)}
                >
                  Revoke certificate
                </Button>
                <Button variant="ghost" onClick={() => setRevoking(null)}>
                  Cancel
                </Button>
              </div>
            ) : null}
          </li>
        ))}
        {can('certificates.issue')
          ? eligible.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span>Completed {e.cohortName}.</span>
                <Button
                  className="h-8 px-3"
                  disabled={issue.isPending}
                  onClick={() => issue.mutate(e.id)}
                >
                  Issue certificate
                </Button>
              </li>
            ))
          : null}
      </ul>
    </Card>
  );
}
