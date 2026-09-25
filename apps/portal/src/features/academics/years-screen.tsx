'use client';

import {
  type AcademicYear,
  academicYearSchema,
  createAcademicYearRequestSchema,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { SectionHeader } from '@/components/section-header';
import { SimpleTable } from '@/components/simple-table';
import { useSession } from '@/features/session/use-session';
import { apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

import { formatDate, useAcademicYears } from './use-catalog';

type FormValues = z.infer<typeof createAcademicYearRequestSchema>;

function YearForm({ editing, onDone }: { editing: AcademicYear | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const idempotency = useIdempotencyKey();
  const form = useForm<FormValues>({
    resolver: zodResolver(createAcademicYearRequestSchema),
    defaultValues: {
      name: editing?.name ?? '',
      startDate: editing?.startDate ?? '',
      endDate: editing?.endDate ?? '',
    },
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      editing
        ? apiRequest(`/academic-years/${editing.id}`, {
            method: 'PATCH',
            body: values,
            schema: academicYearSchema,
            ifMatch: editing.version,
          })
        : apiRequest('/academic-years', {
            method: 'POST',
            body: values,
            schema: academicYearSchema,
            idempotencyKey: idempotency.keyFor(values),
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['academic-years'] });
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {editing ? `Edit ${editing.name}` : 'Add an academic year'}
        </CardTitle>
      </CardHeader>
      <form
        className="grid gap-4 sm:grid-cols-3"
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
      >
        <Field
          label="Name"
          placeholder="e.g. 2026"
          error={errors.name?.message}
          {...form.register('name')}
        />
        <Field
          label="Starts"
          type="date"
          error={errors.startDate?.message}
          {...form.register('startDate')}
        />
        <Field
          label="Ends"
          type="date"
          hint="The day before the next year starts."
          error={errors.endDate?.message}
          {...form.register('endDate')}
        />
        {save.error ? (
          <Alert tone="error" className="sm:col-span-3">
            {errorMessage(save.error)}
          </Alert>
        ) : null}
        <div className="flex justify-end gap-2 sm:col-span-3">
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

export function YearsScreen() {
  const { can } = useSession();
  const years = useAcademicYears();
  const [editing, setEditing] = useState<AcademicYear | 'new' | null>(null);
  const canManage = can('calendar.manage');
  const rows = years.data?.items ?? [];

  return (
    <>
      <SectionHeader
        title="Academic years"
        description="The school years you run. They can't overlap."
        action={
          canManage && editing === null ? (
            <Button onClick={() => setEditing('new')}>Add year</Button>
          ) : null
        }
      />
      {editing !== null ? (
        <YearForm
          key={editing === 'new' ? 'new' : editing.id}
          editing={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}
      {years.error ? <Alert tone="error">{errorMessage(years.error)}</Alert> : null}
      <SimpleTable
        head={['Name', 'Starts', 'Ends', '']}
        empty={!years.isPending && rows.length === 0 ? 'None yet.' : null}
      >
        {rows.map((year) => (
          <tr key={year.id}>
            <td className="px-4 py-3 font-medium">{year.name}</td>
            <td className="px-4 py-3">{formatDate(year.startDate)}</td>
            <td className="px-4 py-3">{formatDate(year.endDate)}</td>
            <td className="px-4 py-3 text-right">
              {canManage ? (
                <Button variant="ghost" className="h-8 px-3" onClick={() => setEditing(year)}>
                  Edit
                </Button>
              ) : null}
            </td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}
