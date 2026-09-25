'use client';

import { applicationSchema, createApplicationRequestSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { SelectField } from '@emis/ui/components/select';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import type { z } from 'zod';

import { useIntakes, useShifts } from '@/features/academics/use-catalog';
import { useInstitution } from '@/features/institution/use-institution';
import { useBranches } from '@/features/institution/use-org-units';
import {
  CustomFieldInputs,
  type CustomValues,
  customFieldErrors,
} from '@/features/people/custom-field-inputs';
import { PersonFields, personToForm } from '@/features/people/person-fields';
import { useDescriptorOptions } from '@/features/people/use-lists';
import { ApiError, apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

import { useCourseOptions } from './use-course-options';

type FormInput = z.input<typeof createApplicationRequestSchema>;
type FormOutput = z.output<typeof createApplicationRequestSchema>;

/** Register a walk-in applicant at the front desk. */
export function ApplicationForm({ onDone }: { onDone: (id: string) => void }) {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const branches = useBranches();
  const sources = useDescriptorOptions('lead_source');
  const courses = useCourseOptions();
  const shifts = useShifts();
  const intakes = useIntakes();
  const idempotency = useIdempotencyKey();
  const [customValues, setCustomValues] = useState<CustomValues>({});

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createApplicationRequestSchema),
    defaultValues: {
      ...personToForm(),
      branchId: '',
      source: 'walk_in',
      // Empty selects mean "no preference"; the register() options below turn '' into null.
      desiredCourseId: null,
      preferredShiftId: null,
      preferredIntakeId: null,
      notes: '',
    },
  });
  const { errors } = form.formState;
  const nullIfEmpty = { setValueAs: (v: string) => v || null };

  const save = useMutation({
    mutationFn: (values: FormOutput) => {
      const body = { ...values, customFields: customValues };
      return apiRequest('/applications', {
        method: 'POST',
        body,
        schema: applicationSchema,
        idempotencyKey: idempotency.keyFor(body),
      });
    },
    onSuccess: async (application) => {
      idempotency.reset();
      await queryClient.invalidateQueries({ queryKey: ['applications'] });
      onDone(application.id);
    },
  });
  const fieldErrors =
    save.error instanceof ApiError ? customFieldErrors(save.error.fieldErrors) : {};

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New applicant</CardTitle>
      </CardHeader>
      <FormProvider {...form}>
        <form
          className="space-y-6"
          noValidate
          onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
        >
          <PersonFields />
          <fieldset className="grid gap-4 sm:grid-cols-3">
            <legend className="mb-3 text-sm font-semibold">Application</legend>
            <SelectField
              label={term('branch')}
              error={errors.branchId?.message}
              {...form.register('branchId')}
            >
              <option value="">Choose…</option>
              {branches.data?.items
                .filter((b) => b.isActive)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </SelectField>
            <SelectField
              label="How did they hear about us?"
              error={errors.source?.message}
              {...form.register('source', nullIfEmpty)}
            >
              <option value="">Not asked</option>
              {sources.data?.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={`Wants to study (${term('course').toLowerCase()})`}
              error={errors.desiredCourseId?.message}
              {...form.register('desiredCourseId', nullIfEmpty)}
            >
              <option value="">Not decided</option>
              {courses.options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={`Preferred ${term('shift').toLowerCase()}`}
              error={errors.preferredShiftId?.message}
              {...form.register('preferredShiftId', nullIfEmpty)}
            >
              <option value="">No preference</option>
              {shifts.data?.items
                .filter((s) => s.isActive)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </SelectField>
            <SelectField
              label={`Preferred ${term('intake').toLowerCase()}`}
              error={errors.preferredIntakeId?.message}
              {...form.register('preferredIntakeId', nullIfEmpty)}
            >
              <option value="">No preference</option>
              {intakes.data?.items
                .filter((i) => i.isActive)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
            </SelectField>
          </fieldset>
          <div className="space-y-1.5">
            <label htmlFor="application-notes" className="text-sm font-medium">
              Notes (optional)
            </label>
            <textarea
              id="application-notes"
              rows={2}
              className="border-border bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
              {...form.register('notes')}
            />
          </div>
          <CustomFieldInputs
            entityType="application"
            values={customValues}
            onChange={setCustomValues}
            errors={fieldErrors}
          />
          {save.error ? <Alert tone="error">{errorMessage(save.error)}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onDone('')}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Register applicant'}
            </Button>
          </div>
        </form>
      </FormProvider>
    </Card>
  );
}
