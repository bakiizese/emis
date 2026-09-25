'use client';

import { createShiftRequestSchema, type Shift, shiftSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { CheckboxField } from '@emis/ui/components/checkbox';
import { Field } from '@emis/ui/components/field';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';

import { SectionHeader } from '@/components/section-header';
import { SimpleTable } from '@/components/simple-table';
import { useInstitution } from '@/features/institution/use-institution';
import { useSession } from '@/features/session/use-session';
import { apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

import { useShifts } from './use-catalog';

/** Monday first; the stored value is 0 = Sunday … 6 = Saturday. */
const DAYS = [
  { value: 1, short: 'Mon' },
  { value: 2, short: 'Tue' },
  { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' },
  { value: 5, short: 'Fri' },
  { value: 6, short: 'Sat' },
  { value: 0, short: 'Sun' },
];

const dayList = (days: number[]) =>
  DAYS.filter((d) => days.includes(d.value))
    .map((d) => d.short)
    .join(', ');

type FormInput = z.input<typeof createShiftRequestSchema>;
type FormOutput = z.output<typeof createShiftRequestSchema>;

function ShiftForm({ editing, onDone }: { editing: Shift | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const idempotency = useIdempotencyKey();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createShiftRequestSchema),
    defaultValues: {
      code: editing?.code ?? '',
      name: editing?.name ?? '',
      daysOfWeek: editing?.daysOfWeek ?? [1, 2, 3, 4, 5],
      startTime: editing?.startTime ?? '',
      endTime: editing?.endTime ?? '',
    },
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: ({ code, ...rest }: FormOutput) =>
      editing
        ? apiRequest(`/shifts/${editing.id}`, {
            method: 'PATCH',
            body: rest,
            schema: shiftSchema,
            ifMatch: editing.version,
          })
        : apiRequest('/shifts', {
            method: 'POST',
            body: { code, ...rest },
            schema: shiftSchema,
            idempotencyKey: idempotency.keyFor({ code, ...rest }),
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['shifts'] });
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {editing ? `Edit ${editing.name}` : `Add a ${term('shift').toLowerCase()}`}
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
          hint={editing ? 'Fixed once created.' : 'e.g. EVE.'}
          error={errors.code?.message}
          {...form.register('code')}
        />
        <Field
          label="Name"
          placeholder="e.g. Evening"
          error={errors.name?.message}
          {...form.register('name')}
        />
        <Field
          label="Starts"
          type="time"
          error={errors.startTime?.message}
          {...form.register('startTime')}
        />
        <Field
          label="Ends"
          type="time"
          error={errors.endTime?.message}
          {...form.register('endTime')}
        />
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium">Days</legend>
          <Controller
            control={form.control}
            name="daysOfWeek"
            render={({ field }) => (
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {DAYS.map((day) => (
                  <CheckboxField
                    key={day.value}
                    label={day.short}
                    checked={field.value.includes(day.value)}
                    onChange={(event) =>
                      field.onChange(
                        event.target.checked
                          ? [...field.value, day.value]
                          : field.value.filter((v) => v !== day.value),
                      )
                    }
                  />
                ))}
              </div>
            )}
          />
          {errors.daysOfWeek ? (
            <p className="mt-1 text-sm text-red-700 dark:text-red-300">
              {errors.daysOfWeek.message ?? 'Pick at least one day.'}
            </p>
          ) : null}
        </fieldset>
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

export function ShiftsScreen() {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const { can } = useSession();
  const shifts = useShifts();
  const [editing, setEditing] = useState<Shift | 'new' | null>(null);
  const canManage = can('facilities.manage');
  const rows = shifts.data?.items ?? [];

  const toggle = useMutation({
    mutationFn: (shift: Shift) =>
      apiRequest(`/shifts/${shift.id}`, {
        method: 'PATCH',
        body: { isActive: !shift.isActive },
        schema: shiftSchema,
        ifMatch: shift.version,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['shifts'] }),
  });

  return (
    <>
      <SectionHeader
        title={term('shift', true)}
        description="The time windows classes run in, e.g. Morning, Afternoon, Evening or Weekend."
        action={
          canManage && editing === null ? (
            <Button onClick={() => setEditing('new')}>Add {term('shift').toLowerCase()}</Button>
          ) : null
        }
      />
      {editing !== null ? (
        <ShiftForm
          key={editing === 'new' ? 'new' : editing.id}
          editing={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}
      {toggle.error ? <Alert tone="error">{errorMessage(toggle.error)}</Alert> : null}
      {shifts.error ? <Alert tone="error">{errorMessage(shifts.error)}</Alert> : null}
      <SimpleTable
        head={[term('shift'), 'Days', 'Time', 'Status', '']}
        empty={!shifts.isPending && rows.length === 0 ? 'None yet.' : null}
      >
        {rows.map((shift) => (
          <tr key={shift.id}>
            <td className="px-4 py-3">
              <div className="font-medium">{shift.name}</div>
              <div className="text-muted-foreground font-mono text-xs">{shift.code}</div>
            </td>
            <td className="px-4 py-3">{dayList(shift.daysOfWeek)}</td>
            <td className="px-4 py-3">
              {shift.startTime}–{shift.endTime}
            </td>
            <td className="px-4 py-3">
              <Badge tone={shift.isActive ? 'success' : 'neutral'}>
                {shift.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              {canManage ? (
                <>
                  <Button variant="ghost" className="h-8 px-3" onClick={() => setEditing(shift)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-8 px-3"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate(shift)}
                  >
                    {shift.isActive ? 'Deactivate' : 'Activate'}
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
