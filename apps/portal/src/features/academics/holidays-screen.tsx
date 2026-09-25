'use client';

import { createHolidayRequestSchema, type Holiday, holidaySchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { CheckboxField } from '@emis/ui/components/checkbox';
import { Field } from '@emis/ui/components/field';
import { SelectField } from '@emis/ui/components/select';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { SectionHeader } from '@/components/section-header';
import { SimpleTable } from '@/components/simple-table';
import { useInstitution } from '@/features/institution/use-institution';
import { useBranches } from '@/features/institution/use-org-units';
import { useSession } from '@/features/session/use-session';
import { apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

import { formatDate, useHolidays } from './use-catalog';

type FormInput = z.input<typeof createHolidayRequestSchema>;
type FormOutput = z.output<typeof createHolidayRequestSchema>;

function HolidayForm({ editing, onDone }: { editing: Holiday | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const branches = useBranches();
  const idempotency = useIdempotencyKey();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createHolidayRequestSchema),
    defaultValues: {
      date: editing?.date ?? '',
      name: editing?.name ?? '',
      isRecurringAnnually: editing?.isRecurringAnnually ?? false,
      branchId: editing?.branchId ?? null,
    },
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: (body: FormOutput) => {
      return editing
        ? apiRequest(`/holidays/${editing.id}`, {
            method: 'PATCH',
            body,
            schema: holidaySchema,
            ifMatch: editing.version,
          })
        : apiRequest('/holidays', {
            method: 'POST',
            body,
            schema: holidaySchema,
            idempotencyKey: idempotency.keyFor(body),
          });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['holidays'] });
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {editing ? `Edit ${editing.name}` : 'Add a holiday'}
        </CardTitle>
      </CardHeader>
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
      >
        <Field label="Date" type="date" error={errors.date?.message} {...form.register('date')} />
        <Field label="Name" error={errors.name?.message} {...form.register('name')} />
        <SelectField
          label={term('branch')}
          error={errors.branchId?.message}
          {...form.register('branchId', { setValueAs: (v: string) => v || null })}
        >
          <option value="">Every {term('branch').toLowerCase()}</option>
          {branches.data?.items
            .filter((b) => b.isActive)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
        </SelectField>
        <CheckboxField
          className="sm:mt-7"
          label="Repeats every year"
          description="For fixed-date holidays."
          {...form.register('isRecurringAnnually')}
        />
        {save.error ? (
          <Alert tone="error" className="sm:col-span-2">
            {errorMessage(save.error)}
          </Alert>
        ) : null}
        <div className="flex justify-end gap-2 sm:col-span-2">
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

export function HolidaysScreen() {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const { can } = useSession();
  const holidays = useHolidays();
  const branches = useBranches();
  const [editing, setEditing] = useState<Holiday | 'new' | null>(null);
  const canManage = can('calendar.manage');
  const rows = holidays.data?.items ?? [];

  const remove = useMutation({
    mutationFn: (holiday: Holiday) => apiRequest(`/holidays/${holiday.id}`, { method: 'DELETE' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['holidays'] }),
  });

  const branchName = (id: string | null) =>
    id
      ? (branches.data?.items.find((b) => b.id === id)?.name ?? '—')
      : `Every ${term('branch').toLowerCase()}`;

  return (
    <>
      <SectionHeader
        title="Holidays"
        description="Days with no classes. Class schedules skip them."
        action={
          canManage && editing === null ? (
            <Button onClick={() => setEditing('new')}>Add holiday</Button>
          ) : null
        }
      />
      {editing !== null ? (
        <HolidayForm
          key={editing === 'new' ? 'new' : editing.id}
          editing={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}
      {remove.error ? <Alert tone="error">{errorMessage(remove.error)}</Alert> : null}
      {holidays.error ? <Alert tone="error">{errorMessage(holidays.error)}</Alert> : null}
      <SimpleTable
        head={['Date', 'Holiday', term('branch'), '']}
        empty={!holidays.isPending && rows.length === 0 ? 'None yet.' : null}
      >
        {rows.map((holiday) => (
          <tr key={holiday.id}>
            <td className="px-4 py-3">{formatDate(holiday.date)}</td>
            <td className="px-4 py-3 font-medium">
              {holiday.name}{' '}
              {holiday.isRecurringAnnually ? <Badge tone="info">Yearly</Badge> : null}
            </td>
            <td className="px-4 py-3">{branchName(holiday.branchId)}</td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              {canManage ? (
                <>
                  <Button variant="ghost" className="h-8 px-3" onClick={() => setEditing(holiday)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-8 px-3"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm(`Delete ${holiday.name}?`)) remove.mutate(holiday);
                    }}
                  >
                    Delete
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
