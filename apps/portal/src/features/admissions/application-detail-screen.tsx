'use client';

import {
  APPLICATION_TRANSITIONS,
  type Application,
  type ApplicationStatus,
  applicationSchema,
  convertResponseSchema,
  duplicateListResponseSchema,
  MANUAL_TARGETS,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { SelectField } from '@emis/ui/components/select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { SectionHeader } from '@/components/section-header';
import { useIntakes, useShifts } from '@/features/academics/use-catalog';
import { useInstitution } from '@/features/institution/use-institution';
import { useBranches } from '@/features/institution/use-org-units';
import {
  CustomFieldInputs,
  type CustomValues,
  customFieldErrors,
} from '@/features/people/custom-field-inputs';
import { DuplicatesPanel } from '@/features/people/duplicates-panel';
import { ApplicationStatusBadge } from '@/features/people/status-badges';
import { useDescriptorOptions } from '@/features/people/use-lists';
import { useSession } from '@/features/session/use-session';
import { ApiError, apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

import { useCourseOptions } from './use-course-options';

type ManualTarget = (typeof MANUAL_TARGETS)[number];

const ACTION_LABELS: Record<
  ManualTarget,
  { label: string; variant: 'primary' | 'secondary' | 'ghost' }
> = {
  contacted: { label: 'Mark as contacted', variant: 'secondary' },
  placement_scheduled: { label: 'Schedule placement test', variant: 'secondary' },
  offered: { label: 'Make an offer', variant: 'primary' },
  rejected: { label: 'Reject', variant: 'ghost' },
  withdrawn: { label: 'Applicant withdrew', variant: 'ghost' },
  expired: { label: 'Offer expired', variant: 'ghost' },
};

const PLACEABLE: ApplicationStatus[] = ['submitted', 'contacted', 'placement_scheduled', 'placed'];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children || '—'}</dd>
    </>
  );
}

function PlacementCard({
  application,
  onSaved,
}: {
  application: Application;
  onSaved: (a: Application) => void;
}) {
  const courses = useCourseOptions();
  const [score, setScore] = useState(
    application.placement ? String(application.placement.score) : '',
  );
  const [courseId, setCourseId] = useState(
    application.placement?.recommendedCourseId ?? application.desiredCourseId ?? '',
  );
  const [notes, setNotes] = useState(application.placement?.notes ?? '');

  const save = useMutation({
    mutationFn: () =>
      apiRequest(`/applications/${application.id}/placement`, {
        method: 'POST',
        body: { score: Number(score), recommendedCourseId: courseId, notes },
        schema: applicationSchema,
        ifMatch: application.version,
      }),
    onSuccess: onSaved,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Placement result</CardTitle>
      </CardHeader>
      <form
        className="grid gap-4 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Field
          label="Score (0–100)"
          type="number"
          step="any"
          min={0}
          max={100}
          required
          value={score}
          onChange={(e) => setScore(e.target.value)}
        />
        <div className="sm:col-span-2">
          <SelectField
            label="Start at"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            required
          >
            <option value="">Choose a level…</option>
            {courses.options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="sm:col-span-3">
          <Field
            label="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {save.error ? (
          <Alert tone="error" className="sm:col-span-3">
            {errorMessage(save.error)}
          </Alert>
        ) : null}
        <div className="flex justify-end sm:col-span-3">
          <Button type="submit" disabled={save.isPending || score === '' || courseId === ''}>
            {save.isPending ? 'Saving…' : application.placement ? 'Update result' : 'Save result'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ConvertCard({
  application,
  onDone,
}: {
  application: Application;
  onDone: (a: Application) => void;
}) {
  const categories = useDescriptorOptions('student_category');
  const idempotency = useIdempotencyKey();
  const [categoryCode, setCategoryCode] = useState('');
  const [customValues, setCustomValues] = useState<CustomValues>({});
  const [existingId, setExistingId] = useState<string | null>(null);

  const matches = useQuery({
    queryKey: ['applications', application.id, 'duplicates'],
    queryFn: () =>
      apiRequest(`/applications/${application.id}/duplicates`, {
        schema: duplicateListResponseSchema,
      }),
  });
  const candidates = matches.data?.items ?? [];

  const convert = useMutation({
    // `confirmNew` is an argument, not state, so "register anyway" applies on the very same click.
    mutationFn: (confirmNew: boolean) => {
      const body = {
        existingStudentId: existingId,
        confirmNotDuplicate: confirmNew,
        categoryCode: categoryCode || null,
        customFields: existingId ? {} : customValues,
      };
      return apiRequest(`/applications/${application.id}/convert`, {
        method: 'POST',
        body,
        schema: convertResponseSchema,
        ifMatch: application.version,
        idempotencyKey: idempotency.keyFor(body),
      });
    },
    onSuccess: (result) => onDone(result.application),
  });
  const fieldErrors =
    convert.error instanceof ApiError ? customFieldErrors(convert.error.fieldErrors) : {};
  const blocked =
    convert.error instanceof ApiError && convert.error.code === 'DUPLICATE_STUDENT_SUSPECTED';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Register as a student</CardTitle>
      </CardHeader>
      <div className="space-y-5">
        <DuplicatesPanel
          candidates={candidates}
          action={(c) => (
            <Button
              variant={existingId === c.student.id ? 'primary' : 'secondary'}
              className="h-8 px-3"
              onClick={() => setExistingId(existingId === c.student.id ? null : c.student.id)}
            >
              {existingId === c.student.id ? 'Linking to this student' : 'This is them'}
            </Button>
          )}
        />
        {existingId ? (
          <p className="text-muted-foreground text-sm">
            The application will be linked to the existing student. No new record is created.
          </p>
        ) : (
          <>
            <SelectField
              label="Category (optional)"
              className="max-w-xs"
              value={categoryCode}
              onChange={(e) => setCategoryCode(e.target.value)}
            >
              <option value="">None</option>
              {categories.data?.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </SelectField>
            <CustomFieldInputs
              entityType="student"
              values={customValues}
              onChange={setCustomValues}
              errors={fieldErrors}
            />
          </>
        )}
        {convert.error ? (
          <Alert tone="error">
            {blocked
              ? 'Someone with the same phone, email or a very similar name is already registered. Check the list above: link to them, or confirm this is a different person.'
              : errorMessage(convert.error)}
          </Alert>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          {blocked && !existingId ? (
            <Button
              variant="secondary"
              disabled={convert.isPending}
              onClick={() => convert.mutate(true)}
            >
              This is someone new, register anyway
            </Button>
          ) : null}
          <Button
            disabled={convert.isPending || matches.isPending}
            onClick={() => convert.mutate(false)}
          >
            {convert.isPending
              ? 'Registering…'
              : existingId
                ? 'Link to student'
                : 'Register student'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function ApplicationDetailScreen({ applicationId }: { applicationId: string }) {
  const queryClient = useQueryClient();
  const { term, moduleOn } = useInstitution();
  const { can } = useSession();
  const branches = useBranches();
  const courses = useCourseOptions();
  const shifts = useShifts();
  const intakes = useIntakes();
  const sources = useDescriptorOptions('lead_source');
  const [notice, setNotice] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['applications', 'one', applicationId],
    queryFn: () => apiRequest(`/applications/${applicationId}`, { schema: applicationSchema }),
  });
  const application = query.data;

  const refresh = async (updated: Application) => {
    queryClient.setQueryData(['applications', 'one', applicationId], updated);
    await queryClient.invalidateQueries({ queryKey: ['applications'], exact: false });
  };

  const move = useMutation({
    mutationFn: (to: ManualTarget) =>
      apiRequest(`/applications/${applicationId}/transition`, {
        method: 'POST',
        body: { to },
        schema: applicationSchema,
        ifMatch: application?.version,
      }),
    onSuccess: async (updated) => {
      setNotice(null);
      await refresh(updated);
    },
  });

  if (query.error) return <Alert tone="error">{errorMessage(query.error)}</Alert>;
  if (!application) return null;

  const canManage = can('admissions.manage');
  const allowed = APPLICATION_TRANSITIONS[application.status].filter(
    (to): to is ManualTarget =>
      (MANUAL_TARGETS as readonly string[]).includes(to) &&
      (to !== 'placement_scheduled' || moduleOn('placement')),
  );
  const nameOf = <T extends { id: string; name: string }>(
    list: T[] | undefined,
    id: string | null,
  ) => (id ? (list?.find((x) => x.id === id)?.name ?? '—') : '');
  const fullName =
    `${application.givenName} ${application.fatherName} ${application.grandfatherName ?? ''}`.trim();
  const placementCourse = courses.options.find(
    (c) => c.id === application.placement?.recommendedCourseId,
  )?.label;

  return (
    <div className="space-y-6">
      <Link href="/admissions" className="text-muted-foreground text-sm hover:underline">
        ← All applications
      </Link>
      <SectionHeader
        title={fullName}
        description={`${application.reference} · received ${new Date(application.createdAt).toLocaleDateString()}`}
        action={<ApplicationStatusBadge status={application.status} />}
      />
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {move.error ? <Alert tone="error">{errorMessage(move.error)}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Applicant</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-[10rem_1fr] gap-x-6 gap-y-2 text-sm">
          <Row label="Phone">{application.phone}</Row>
          <Row label="Email">{application.email}</Row>
          <Row label="Gender">{application.gender === 'female' ? 'Female' : 'Male'}</Row>
          <Row label="Date of birth">{application.dateOfBirth}</Row>
          <Row label="City">
            {[application.city, application.address].filter(Boolean).join(', ')}
          </Row>
          <Row label={term('branch')}>
            {branches.data?.items.find((b) => b.id === application.branchId)?.name}
          </Row>
          <Row label="Heard about us">
            {sources.data?.find((s) => s.code === application.source)?.label ?? application.source}
          </Row>
          <Row label="Wants to study">
            {courses.options.find((c) => c.id === application.desiredCourseId)?.label}
          </Row>
          <Row label={`Preferred ${term('shift').toLowerCase()}`}>
            {nameOf(shifts.data?.items, application.preferredShiftId)}
          </Row>
          <Row label={`Preferred ${term('intake').toLowerCase()}`}>
            {nameOf(intakes.data?.items, application.preferredIntakeId)}
          </Row>
          <Row label="Notes">{application.notes}</Row>
        </dl>
      </Card>

      {application.placement ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Placement</CardTitle>
          </CardHeader>
          <p className="text-sm">
            Scored <strong>{application.placement.score}</strong>. Start at{' '}
            <strong>{placementCourse ?? '…'}</strong>.
            {application.placement.notes ? ` ${application.placement.notes}` : ''}
          </p>
        </Card>
      ) : null}

      {application.studentId ? (
        <Alert tone="success">
          Registered as a student.{' '}
          <Link href={`/students/${application.studentId}`} className="font-medium underline">
            Open the student record
          </Link>
        </Alert>
      ) : null}

      {canManage && allowed.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Next step</CardTitle>
          </CardHeader>
          <div className="flex flex-wrap gap-2">
            {allowed.map((to) => (
              <Button
                key={to}
                variant={ACTION_LABELS[to].variant}
                disabled={move.isPending}
                onClick={() => {
                  if (
                    (to === 'rejected' || to === 'withdrawn') &&
                    !window.confirm(`${ACTION_LABELS[to].label}? This closes the application.`)
                  ) {
                    return;
                  }
                  move.mutate(to);
                }}
              >
                {ACTION_LABELS[to].label}
              </Button>
            ))}
          </div>
        </Card>
      ) : null}

      {moduleOn('placement') &&
      can('placement.record') &&
      PLACEABLE.includes(application.status) ? (
        <PlacementCard
          key={application.version}
          application={application}
          onSaved={(updated) => {
            setNotice('Placement saved.');
            void refresh(updated);
          }}
        />
      ) : null}

      {canManage && application.status === 'offered' && !application.studentId ? (
        <ConvertCard
          key={application.version}
          application={application}
          onDone={(updated) => {
            void refresh(updated);
            void queryClient.invalidateQueries({ queryKey: ['students'] });
            setNotice('Registered as a student.');
          }}
        />
      ) : null}
    </div>
  );
}
