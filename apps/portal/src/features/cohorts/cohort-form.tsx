'use client';

import { type Cohort, cohortSchema, createCohortRequestSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { SelectField } from '@emis/ui/components/select';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { useIntakes, useRooms, useShifts } from '@/features/academics/use-catalog';
import { useCourseOptions } from '@/features/admissions/use-course-options';
import { useInstitution } from '@/features/institution/use-institution';
import { apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

import { useInstructors } from './use-cohorts';

type FormInput = z.input<typeof createCohortRequestSchema>;
type FormOutput = z.output<typeof createCohortRequestSchema>;

/** Create a cohort, or (with `editing`) change one. A running cohort keeps its schedule fixed. */
export function CohortForm({
  editing,
  onDone,
}: {
  editing: Cohort | null;
  onDone: (cohort?: Cohort) => void;
}) {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const courses = useCourseOptions();
  const shifts = useShifts();
  const rooms = useRooms();
  const intakes = useIntakes();
  const instructors = useInstructors();
  const idempotency = useIdempotencyKey();
  const locked = editing?.status === 'running';
  const nullIfEmpty = { setValueAs: (v: string) => v || null };

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createCohortRequestSchema),
    defaultValues: {
      name: editing?.name ?? '',
      courseId: editing?.courseId ?? '',
      intakeId: editing?.intakeId ?? null,
      shiftId: editing?.shiftId ?? '',
      roomId: editing?.roomId ?? '',
      instructorId: editing?.instructorId ?? null,
      startDate: editing?.startDate ?? '',
      endDate: editing?.endDate ?? '',
      maxSize: editing?.maxSize ?? 20,
    },
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: ({ courseId, ...rest }: FormOutput) => {
      if (editing) {
        const body = locked
          ? { name: rest.name, intakeId: rest.intakeId, maxSize: rest.maxSize }
          : rest;
        return apiRequest(`/cohorts/${editing.id}`, {
          method: 'PATCH',
          body,
          schema: cohortSchema,
          ifMatch: editing.version,
        });
      }
      const body = { courseId, ...rest };
      return apiRequest('/cohorts', {
        method: 'POST',
        body,
        schema: cohortSchema,
        idempotencyKey: idempotency.keyFor(body),
      });
    },
    onSuccess: async (cohort) => {
      queryClient.setQueryData(['cohorts', 'one', cohort.id], cohort);
      await queryClient.invalidateQueries({ queryKey: ['cohorts'] });
      onDone(cohort);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {editing ? `Edit ${editing.name}` : `New ${term('cohort').toLowerCase()}`}
        </CardTitle>
      </CardHeader>
      <form
        className="grid gap-4 sm:grid-cols-3"
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
      >
        <div className="sm:col-span-2">
          <Field
            label="Name"
            placeholder="e.g. English A2, evening, Sept 2026"
            error={errors.name?.message}
            {...form.register('name')}
          />
        </div>
        <SelectField
          label={term('course')}
          disabled={editing !== null}
          error={errors.courseId?.message}
          {...form.register('courseId')}
        >
          <option value="">Choose…</option>
          {courses.options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={term('shift')}
          disabled={locked}
          error={errors.shiftId?.message}
          {...form.register('shiftId')}
        >
          <option value="">Choose…</option>
          {shifts.data?.items
            .filter((s) => s.isActive || s.id === editing?.shiftId)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.startTime}–{s.endTime})
              </option>
            ))}
        </SelectField>
        <SelectField
          label="Room"
          disabled={locked}
          error={errors.roomId?.message}
          {...form.register('roomId')}
        >
          <option value="">Choose…</option>
          {rooms.data?.items
            .filter((r) => r.isActive || r.id === editing?.roomId)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.capacity} seats)
              </option>
            ))}
        </SelectField>
        <SelectField
          label={term('instructor')}
          disabled={locked}
          error={errors.instructorId?.message}
          {...form.register('instructorId', nullIfEmpty)}
        >
          <option value="">Not assigned</option>
          {instructors.data?.items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.displayName}
            </option>
          ))}
        </SelectField>
        <Field
          label="First class on or after"
          type="date"
          disabled={locked}
          error={errors.startDate?.message}
          {...form.register('startDate')}
        />
        <Field
          label="Last class on or before"
          type="date"
          disabled={locked}
          error={errors.endDate?.message}
          {...form.register('endDate')}
        />
        <Field
          label="Most students"
          type="number"
          hint="The room's seats also apply, whichever is smaller."
          error={errors.maxSize?.message}
          {...form.register('maxSize', { valueAsNumber: true })}
        />
        <SelectField
          label={`${term('intake')} (optional)`}
          error={errors.intakeId?.message}
          {...form.register('intakeId', nullIfEmpty)}
        >
          <option value="">None</option>
          {intakes.data?.items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </SelectField>
        {save.error ? (
          <Alert tone="error" className="sm:col-span-3">
            {errorMessage(save.error)}
          </Alert>
        ) : null}
        <div className="flex justify-end gap-2 sm:col-span-3">
          <Button variant="ghost" onClick={() => onDone()}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
