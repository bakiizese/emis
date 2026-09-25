'use client';

import {
  createStudentRequestSchema,
  type DuplicateCandidate,
  duplicateListResponseSchema,
  studentSchema,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { SelectField } from '@emis/ui/components/select';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import type { z } from 'zod';

import { useBranches } from '@/features/institution/use-org-units';
import { useInstitution } from '@/features/institution/use-institution';
import {
  CustomFieldInputs,
  type CustomValues,
  customFieldErrors,
} from '@/features/people/custom-field-inputs';
import { DuplicatesPanel } from '@/features/people/duplicates-panel';
import { PersonFields, personToForm } from '@/features/people/person-fields';
import { useDescriptorOptions } from '@/features/people/use-lists';
import { ApiError, apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

type FormInput = z.input<typeof createStudentRequestSchema>;
type FormOutput = z.output<typeof createStudentRequestSchema>;

/** Register a student. If someone similar exists, shows them and asks before creating another. */
export function StudentForm({ onDone }: { onDone: (id: string) => void }) {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const branches = useBranches();
  const categories = useDescriptorOptions('student_category');
  const idempotency = useIdempotencyKey();
  const [customValues, setCustomValues] = useState<CustomValues>({});
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [pending, setPending] = useState<FormOutput | null>(null);

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createStudentRequestSchema),
    defaultValues: {
      ...personToForm(),
      branchId: '',
      categoryCode: '',
      confirmNotDuplicate: false,
    },
  });
  const { errors } = form.formState;
  const activeBranches = branches.data?.items.filter((b) => b.isActive) ?? [];

  const save = useMutation({
    mutationFn: async (values: FormOutput) => {
      const body = { ...values, customFields: customValues };
      try {
        return await apiRequest('/students', {
          method: 'POST',
          body,
          schema: studentSchema,
          idempotencyKey: idempotency.keyFor(body),
        });
      } catch (error) {
        if (error instanceof ApiError && error.code === 'DUPLICATE_STUDENT_SUSPECTED') {
          const params = new URLSearchParams(
            Object.entries({
              givenName: values.givenName,
              fatherName: values.fatherName,
              grandfatherName: values.grandfatherName ?? '',
              phone: values.phone,
              email: values.email ?? '',
            }).filter(([, v]) => v),
          );
          const found = await apiRequest(`/students/duplicates?${params.toString()}`, {
            schema: duplicateListResponseSchema,
          });
          setCandidates(found.items);
          setPending(values);
        }
        throw error;
      }
    },
    onSuccess: async (student) => {
      idempotency.reset();
      await queryClient.invalidateQueries({ queryKey: ['students'] });
      onDone(student.id);
    },
  });

  const isDuplicateStop =
    save.error instanceof ApiError && save.error.code === 'DUPLICATE_STUDENT_SUSPECTED';
  const fieldErrors =
    save.error instanceof ApiError ? customFieldErrors(save.error.fieldErrors) : {};

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Register a {term('student').toLowerCase()}</CardTitle>
      </CardHeader>
      <FormProvider {...form}>
        <form
          className="space-y-6"
          noValidate
          onSubmit={(event) => {
            setCandidates([]);
            void form.handleSubmit((values) => save.mutate(values))(event);
          }}
        >
          <PersonFields />
          <fieldset className="grid gap-4 sm:grid-cols-3">
            <legend className="mb-3 text-sm font-semibold">Enrolment</legend>
            <SelectField
              label={term('branch')}
              error={errors.branchId?.message}
              {...form.register('branchId')}
            >
              <option value="">Choose…</option>
              {activeBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Category (optional)"
              error={errors.categoryCode?.message}
              {...form.register('categoryCode')}
            >
              <option value="">None</option>
              {categories.data?.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </SelectField>
          </fieldset>
          <CustomFieldInputs
            entityType="student"
            values={customValues}
            onChange={setCustomValues}
            errors={fieldErrors}
          />

          {isDuplicateStop ? (
            <div className="space-y-3">
              <DuplicatesPanel candidates={candidates} />
              <Alert tone="error">
                A student with the same phone, email or a very similar name exists. If this is a
                different person, register them anyway.
              </Alert>
              <Button
                variant="secondary"
                disabled={save.isPending || pending === null}
                onClick={() => pending && save.mutate({ ...pending, confirmNotDuplicate: true })}
              >
                This is someone new, register anyway
              </Button>
            </div>
          ) : save.error ? (
            <Alert tone="error">{errorMessage(save.error)}</Alert>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onDone('')}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Registering…' : 'Register'}
            </Button>
          </div>
        </form>
      </FormProvider>
    </Card>
  );
}
