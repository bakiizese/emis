'use client';

import {
  createProgramRequestSchema,
  PROGRAM_TYPES,
  type Program,
  type ProgramType,
  programSchema,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { SelectField } from '@emis/ui/components/select';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { SectionHeader } from '@/components/section-header';
import { SimpleTable } from '@/components/simple-table';
import { useInstitution } from '@/features/institution/use-institution';
import { useDepartments } from '@/features/institution/use-org-units';
import { useSession } from '@/features/session/use-session';
import { apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

import { usePrograms } from './use-catalog';

export const PROGRAM_TYPE_LABELS: Record<ProgramType, string> = {
  long_course: 'Long course',
  short_course: 'Short course',
  exam_prep: 'Exam preparation',
};

type FormInput = z.input<typeof createProgramRequestSchema>;
type FormOutput = z.output<typeof createProgramRequestSchema>;

function ProgramForm({ editing, onDone }: { editing: Program | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const departments = useDepartments();
  const idempotency = useIdempotencyKey();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createProgramRequestSchema),
    defaultValues: {
      departmentId: editing?.departmentId ?? '',
      code: editing?.code ?? '',
      name: editing?.name ?? '',
      type: editing?.type ?? 'long_course',
      description: editing?.description ?? '',
      sortOrder: editing?.sortOrder ?? 0,
    },
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: ({ name, description, sortOrder, ...fixed }: FormOutput) =>
      editing
        ? apiRequest(`/programs/${editing.id}`, {
            method: 'PATCH',
            body: { name, description, sortOrder },
            schema: programSchema,
            ifMatch: editing.version,
          })
        : apiRequest('/programs', {
            method: 'POST',
            body: { ...fixed, name, description, sortOrder },
            schema: programSchema,
            idempotencyKey: idempotency.keyFor({ ...fixed, name, description, sortOrder }),
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['programs'] });
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {editing ? `Edit ${editing.name}` : `Add a ${term('program').toLowerCase()}`}
        </CardTitle>
      </CardHeader>
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
      >
        <SelectField
          label={term('department')}
          disabled={editing !== null}
          error={errors.departmentId?.message}
          {...form.register('departmentId')}
        >
          <option value="">Choose…</option>
          {departments.data?.items
            .filter((d) => d.isActive || d.id === editing?.departmentId)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </SelectField>
        <SelectField
          label="Type"
          disabled={editing !== null}
          error={errors.type?.message}
          {...form.register('type')}
        >
          {PROGRAM_TYPES.map((type) => (
            <option key={type} value={type}>
              {PROGRAM_TYPE_LABELS[type]}
            </option>
          ))}
        </SelectField>
        <Field
          label="Code"
          readOnly={editing !== null}
          hint={editing ? 'Fixed once created.' : '2–10 letters or digits, e.g. GENL.'}
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

export function ProgramsScreen() {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const { can } = useSession();
  const departments = useDepartments();
  const [departmentId, setDepartmentId] = useState('');
  const programs = usePrograms(departmentId || undefined);
  const [editing, setEditing] = useState<Program | 'new' | null>(null);
  const canManage = can('catalog.manage');

  const togglePublished = useMutation({
    mutationFn: (program: Program) =>
      apiRequest(`/programs/${program.id}`, {
        method: 'PATCH',
        body: { isPublished: !program.isPublished },
        schema: programSchema,
        ifMatch: program.version,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['programs'] }),
  });

  const departmentName = (id: string) =>
    departments.data?.items.find((d) => d.id === id)?.name ?? '—';
  const rows = programs.data?.items ?? [];

  return (
    <>
      <SectionHeader
        title={term('program', true)}
        description={`What you teach under each ${term('department').toLowerCase()}. Open one to manage its ${term('course', true).toLowerCase()}, prerequisites and completion rules.`}
        action={
          canManage && editing === null ? (
            <Button onClick={() => setEditing('new')}>Add {term('program').toLowerCase()}</Button>
          ) : null
        }
      />
      {editing !== null ? (
        <ProgramForm
          key={editing === 'new' ? 'new' : editing.id}
          editing={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}
      <SelectField
        label={`Show ${term('department').toLowerCase()}`}
        className="max-w-xs"
        value={departmentId}
        onChange={(event) => setDepartmentId(event.target.value)}
      >
        <option value="">All</option>
        {departments.data?.items.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </SelectField>
      {togglePublished.error ? (
        <Alert tone="error">{errorMessage(togglePublished.error)}</Alert>
      ) : null}
      {programs.error ? <Alert tone="error">{errorMessage(programs.error)}</Alert> : null}
      <SimpleTable
        head={['Program', term('department'), 'Type', 'Status', '']}
        empty={!programs.isPending && rows.length === 0 ? 'None yet.' : null}
      >
        {rows.map((program) => (
          <tr key={program.id}>
            <td className="px-4 py-3">
              <Link
                href={`/academics/programs/${program.id}`}
                className="font-medium hover:underline"
              >
                {program.name}
              </Link>
              <div className="text-muted-foreground font-mono text-xs">{program.code}</div>
            </td>
            <td className="px-4 py-3">{departmentName(program.departmentId)}</td>
            <td className="px-4 py-3">{PROGRAM_TYPE_LABELS[program.type]}</td>
            <td className="px-4 py-3">
              <Badge tone={program.isPublished ? 'success' : 'neutral'}>
                {program.isPublished ? 'Published' : 'Draft'}
              </Badge>
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <Link
                href={`/academics/programs/${program.id}`}
                className="hover:bg-secondary inline-flex h-8 items-center rounded-md px-3 text-sm font-medium"
              >
                Open
              </Link>
              {canManage ? (
                <>
                  <Button variant="ghost" className="h-8 px-3" onClick={() => setEditing(program)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-8 px-3"
                    disabled={togglePublished.isPending}
                    onClick={() => togglePublished.mutate(program)}
                  >
                    {program.isPublished ? 'Unpublish' : 'Publish'}
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
