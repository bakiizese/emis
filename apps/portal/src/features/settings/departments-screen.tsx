'use client';

import { createDepartmentRequestSchema, type Department, departmentSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { useInstitution } from '@/features/institution/use-institution';
import { useDepartments } from '@/features/institution/use-org-units';
import { apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

import { SettingsHeader } from './settings-nav';
import { SimpleTable } from '@/components/simple-table';

type FormInput = z.input<typeof createDepartmentRequestSchema>;
type FormOutput = z.output<typeof createDepartmentRequestSchema>;

function DepartmentForm({ editing, onDone }: { editing: Department | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const idempotency = useIdempotencyKey();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createDepartmentRequestSchema),
    defaultValues: {
      code: editing?.code ?? '',
      name: editing?.name ?? '',
      description: editing?.description ?? '',
      sortOrder: editing?.sortOrder ?? 0,
    },
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: ({ code, ...rest }: FormOutput) =>
      editing
        ? apiRequest(`/departments/${editing.id}`, {
            method: 'PATCH',
            body: rest,
            schema: departmentSchema,
            ifMatch: editing.version,
          })
        : apiRequest('/departments', {
            method: 'POST',
            body: { code, ...rest },
            schema: departmentSchema,
            idempotencyKey: idempotency.keyFor({ code, ...rest }),
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['departments'] });
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {editing ? `Edit ${editing.name}` : `Add a ${term('department').toLowerCase()}`}
        </CardTitle>
      </CardHeader>
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
      >
        <Field
          label="Code"
          hint={
            editing ? 'Codes are fixed: records use them.' : '2–10 letters or digits, e.g. LANG.'
          }
          readOnly={editing !== null}
          error={errors.code?.message}
          {...form.register('code')}
        />
        <Field label="Name" error={errors.name?.message} {...form.register('name')} />
        <div className="sm:col-span-2">
          <Field
            label="Description (optional)"
            error={errors.description?.message}
            {...form.register('description')}
          />
        </div>
        <Field
          label="Display order"
          type="number"
          hint="Lower numbers come first."
          error={errors.sortOrder?.message}
          {...form.register('sortOrder', { valueAsNumber: true })}
        />
        {save.error ? (
          <Alert tone="error" className="sm:col-span-2">
            {errorMessage(save.error)}
          </Alert>
        ) : null}
        <div className="flex items-end justify-end gap-2">
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

export function DepartmentsScreen() {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const departments = useDepartments();
  const [editing, setEditing] = useState<Department | 'new' | null>(null);

  const toggle = useMutation({
    mutationFn: (department: Department) =>
      apiRequest(`/departments/${department.id}`, {
        method: 'PATCH',
        body: { isActive: !department.isActive },
        schema: departmentSchema,
        ifMatch: department.version,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['departments'] }),
  });

  const rows = departments.data?.items ?? [];
  return (
    <>
      <SettingsHeader
        title={term('department', true)}
        description="What you teach, e.g. Language or Computer. Programs and courses sit under a department, and coordinators can be limited to one."
        action={
          editing === null ? (
            <Button onClick={() => setEditing('new')}>
              Add {term('department').toLowerCase()}
            </Button>
          ) : null
        }
      />
      {editing !== null ? (
        <DepartmentForm
          key={editing === 'new' ? 'new' : editing.id}
          editing={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}
      {toggle.error ? <Alert tone="error">{errorMessage(toggle.error)}</Alert> : null}
      {departments.error ? <Alert tone="error">{errorMessage(departments.error)}</Alert> : null}
      <SimpleTable
        head={['Code', 'Name', 'Status', '']}
        empty={!departments.isPending && rows.length === 0 ? 'None yet.' : null}
      >
        {rows.map((department) => (
          <tr key={department.id}>
            <td className="px-4 py-3 font-mono text-xs">{department.code}</td>
            <td className="px-4 py-3">
              <div className="font-medium">{department.name}</div>
              {department.description ? (
                <div className="text-muted-foreground">{department.description}</div>
              ) : null}
            </td>
            <td className="px-4 py-3">
              <Badge tone={department.isActive ? 'success' : 'neutral'}>
                {department.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <Button variant="ghost" className="h-8 px-3" onClick={() => setEditing(department)}>
                Edit
              </Button>
              <Button
                variant="ghost"
                className="h-8 px-3"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(department)}
              >
                {department.isActive ? 'Deactivate' : 'Activate'}
              </Button>
            </td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}
