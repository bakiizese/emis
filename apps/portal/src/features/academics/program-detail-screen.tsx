'use client';

import { type Course, courseSchema, createCourseRequestSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { CheckboxField } from '@emis/ui/components/checkbox';
import { Field } from '@emis/ui/components/field';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { SectionHeader } from '@/components/section-header';
import { SimpleTable } from '@/components/simple-table';
import { useInstitution } from '@/features/institution/use-institution';
import { useSession } from '@/features/session/use-session';
import { apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';
import { programSchema } from '@emis/contracts';

import { PROGRAM_TYPE_LABELS } from './programs-screen';
import { useCourses } from './use-catalog';

// The program id comes from the page, and the code is fixed once created.
const formSchema = createCourseRequestSchema.omit({ programId: true });
type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

/** Number inputs give NaN when empty; the API wants null for "not set". */
const optionalNumber = { setValueAs: (v: string) => (v === '' || v === null ? null : Number(v)) };

function CourseForm({
  programId,
  editing,
  onDone,
}: {
  programId: string;
  editing: Course | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const idempotency = useIdempotencyKey();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      code: editing?.code ?? '',
      name: editing?.name ?? '',
      levelOrder: editing?.levelOrder ?? 0,
      durationWeeks: editing?.durationWeeks ?? null,
      totalHours: editing?.totalHours ?? null,
      minAttendancePercent: editing?.minAttendancePercent ?? null,
      minScore: editing?.minScore ?? null,
      certificateEligible: editing?.certificateEligible ?? true,
      sortOrder: editing?.sortOrder ?? 0,
    },
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: ({ code, ...rest }: FormOutput) =>
      editing
        ? apiRequest(`/courses/${editing.id}`, {
            method: 'PATCH',
            body: rest,
            schema: courseSchema,
            ifMatch: editing.version,
          })
        : apiRequest('/courses', {
            method: 'POST',
            body: { programId, code, ...rest },
            schema: courseSchema,
            idempotencyKey: idempotency.keyFor({ programId, code, ...rest }),
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['courses', programId] });
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {editing ? `Edit ${editing.name}` : `Add a ${term('course').toLowerCase()}`}
        </CardTitle>
      </CardHeader>
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
      >
        <Field
          label="Code"
          readOnly={editing !== null}
          hint={editing ? 'Fixed once created.' : 'e.g. A1, IELTS, PY1.'}
          error={errors.code?.message}
          {...form.register('code')}
        />
        <Field label="Name" error={errors.name?.message} {...form.register('name')} />
        <Field
          label="Level order"
          type="number"
          hint="1 = first level. Sets the order within the program."
          error={errors.levelOrder?.message}
          {...form.register('levelOrder', { valueAsNumber: true })}
        />
        <Field
          label="Display order"
          type="number"
          error={errors.sortOrder?.message}
          {...form.register('sortOrder', { valueAsNumber: true })}
        />
        <Field
          label="Duration (weeks, optional)"
          type="number"
          error={errors.durationWeeks?.message}
          {...form.register('durationWeeks', optionalNumber)}
        />
        <Field
          label="Total hours (optional)"
          type="number"
          error={errors.totalHours?.message}
          {...form.register('totalHours', optionalNumber)}
        />
        <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">Completion rules</legend>
          <Field
            label="Minimum attendance % (optional)"
            type="number"
            hint="Below this, the student can't complete the course."
            error={errors.minAttendancePercent?.message}
            {...form.register('minAttendancePercent', optionalNumber)}
          />
          <Field
            label="Minimum score % (optional)"
            type="number"
            step="any"
            hint="Pass mark for the final result."
            error={errors.minScore?.message}
            {...form.register('minScore', optionalNumber)}
          />
          <div className="sm:col-span-2">
            <CheckboxField
              label="Issues a certificate"
              description="Completing this course makes the student eligible for a certificate."
              {...form.register('certificateEligible')}
            />
          </div>
        </fieldset>
        {save.error ? (
          <Alert tone="error" className="sm:col-span-2">
            {errorMessage(save.error)}
          </Alert>
        ) : null}
        <div className="flex items-end justify-end gap-2 sm:col-span-2">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PrerequisitesForm({
  course,
  all,
  onDone,
}: {
  course: Course;
  all: Course[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(new Set(course.prerequisiteIds));
  const others = all.filter((c) => c.id !== course.id);

  const save = useMutation({
    mutationFn: () =>
      apiRequest(`/courses/${course.id}/prerequisites`, {
        method: 'PUT',
        body: { courseIds: [...selected] },
        schema: courseSchema,
        ifMatch: course.version,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['courses', course.programId] });
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Prerequisites for {course.name}</CardTitle>
      </CardHeader>
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Students must complete these first. Only courses in this program can be picked, and
          courses can&apos;t require each other in a loop.
        </p>
        {others.length === 0 ? (
          <p className="text-sm">There are no other courses in this program yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {others.map((other) => (
              <CheckboxField
                key={other.id}
                label={`${other.code} · ${other.name}`}
                checked={selected.has(other.id)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(other.id);
                  else next.delete(other.id);
                  setSelected(next);
                }}
              />
            ))}
          </div>
        )}
        {save.error ? <Alert tone="error">{errorMessage(save.error)}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save prerequisites'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function ProgramDetailScreen({ programId }: { programId: string }) {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const { can } = useSession();
  const program = useQuery({
    queryKey: ['programs', 'one', programId],
    queryFn: () => apiRequest(`/programs/${programId}`, { schema: programSchema }),
  });
  const courses = useCourses(programId);
  const [panel, setPanel] = useState<
    { kind: 'course'; course: Course | null } | { kind: 'prerequisites'; course: Course } | null
  >(null);
  const canManage = can('catalog.manage');

  const toggle = useMutation({
    mutationFn: (course: Course) =>
      apiRequest(`/courses/${course.id}`, {
        method: 'PATCH',
        body: { isActive: !course.isActive },
        schema: courseSchema,
        ifMatch: course.version,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['courses', programId] }),
  });

  const rows = courses.data?.items ?? [];
  const nameOf = (id: string) => rows.find((c) => c.id === id)?.code ?? '?';

  return (
    <>
      <Link href="/academics" className="text-muted-foreground text-sm hover:underline">
        ← All {term('program', true).toLowerCase()}
      </Link>
      {program.error ? <Alert tone="error">{errorMessage(program.error)}</Alert> : null}
      <SectionHeader
        title={program.data ? program.data.name : term('program')}
        description={
          program.data
            ? `${PROGRAM_TYPE_LABELS[program.data.type]} · ${program.data.code}${program.data.description ? ` · ${program.data.description}` : ''}`
            : ''
        }
        action={
          canManage && panel === null ? (
            <Button onClick={() => setPanel({ kind: 'course', course: null })}>
              Add {term('course').toLowerCase()}
            </Button>
          ) : null
        }
      />
      {panel?.kind === 'course' ? (
        <CourseForm
          key={panel.course?.id ?? 'new'}
          programId={programId}
          editing={panel.course}
          onDone={() => setPanel(null)}
        />
      ) : null}
      {panel?.kind === 'prerequisites' ? (
        <PrerequisitesForm
          key={panel.course.id}
          course={panel.course}
          all={rows}
          onDone={() => setPanel(null)}
        />
      ) : null}
      {toggle.error ? <Alert tone="error">{errorMessage(toggle.error)}</Alert> : null}
      {courses.error ? <Alert tone="error">{errorMessage(courses.error)}</Alert> : null}
      <SimpleTable
        head={['Level', term('course'), 'Length', 'To complete', 'Needs first', 'Status', '']}
        empty={!courses.isPending && rows.length === 0 ? 'No courses yet.' : null}
      >
        {rows.map((course) => (
          <tr key={course.id}>
            <td className="px-4 py-3">{course.levelOrder}</td>
            <td className="px-4 py-3">
              <div className="font-medium">{course.name}</div>
              <div className="text-muted-foreground font-mono text-xs">{course.code}</div>
            </td>
            <td className="text-muted-foreground px-4 py-3">
              {[
                course.durationWeeks ? `${course.durationWeeks} wk` : null,
                course.totalHours ? `${course.totalHours} h` : null,
              ]
                .filter(Boolean)
                .join(' · ') || '—'}
            </td>
            <td className="text-muted-foreground px-4 py-3">
              {[
                course.minAttendancePercent === null
                  ? null
                  : `${course.minAttendancePercent}% attendance`,
                course.minScore === null ? null : `${course.minScore}% score`,
              ]
                .filter(Boolean)
                .join(' · ') || 'No rules'}
              {course.certificateEligible ? null : <div className="text-xs">No certificate</div>}
            </td>
            <td className="px-4 py-3">
              {course.prerequisiteIds.length > 0
                ? course.prerequisiteIds.map(nameOf).join(', ')
                : '—'}
            </td>
            <td className="px-4 py-3">
              <Badge tone={course.isActive ? 'success' : 'neutral'}>
                {course.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              {canManage ? (
                <>
                  <Button
                    variant="ghost"
                    className="h-8 px-3"
                    onClick={() => setPanel({ kind: 'course', course })}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-8 px-3"
                    onClick={() => setPanel({ kind: 'prerequisites', course })}
                  >
                    Prerequisites
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-8 px-3"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate(course)}
                  >
                    {course.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </>
              ) : null}
            </td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}
