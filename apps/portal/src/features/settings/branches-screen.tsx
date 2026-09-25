'use client';

import { type Branch, branchSchema, createBranchRequestSchema } from '@emis/contracts';
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
import { useBranches } from '@/features/institution/use-org-units';
import { apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

import { SettingsHeader } from './settings-nav';
import { SimpleTable } from '@/components/simple-table';

type FormInput = z.input<typeof createBranchRequestSchema>;
type FormOutput = z.output<typeof createBranchRequestSchema>;

function BranchForm({ editing, onDone }: { editing: Branch | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const idempotency = useIdempotencyKey();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createBranchRequestSchema),
    defaultValues: {
      code: editing?.code ?? '',
      name: editing?.name ?? '',
      address: editing?.address ?? '',
      phone: editing?.phone ?? '',
    },
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: ({ code, ...rest }: FormOutput) =>
      editing
        ? apiRequest(`/branches/${editing.id}`, {
            method: 'PATCH',
            body: rest,
            schema: branchSchema,
            ifMatch: editing.version,
          })
        : apiRequest('/branches', {
            method: 'POST',
            body: { code, ...rest },
            schema: branchSchema,
            idempotencyKey: idempotency.keyFor({ code, ...rest }),
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['branches'] });
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {editing ? `Edit ${editing.name}` : `Add a ${term('branch').toLowerCase()}`}
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
            editing
              ? 'Codes are fixed: numbers and records use them.'
              : '2–10 letters or digits, e.g. BOLE.'
          }
          readOnly={editing !== null}
          error={errors.code?.message}
          {...form.register('code')}
        />
        <Field label="Name" error={errors.name?.message} {...form.register('name')} />
        <Field
          label="Address (optional)"
          error={errors.address?.message}
          {...form.register('address')}
        />
        <Field label="Phone (optional)" error={errors.phone?.message} {...form.register('phone')} />
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

export function BranchesScreen() {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const branches = useBranches();
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);

  const toggle = useMutation({
    mutationFn: (branch: Branch) =>
      apiRequest(`/branches/${branch.id}`, {
        method: 'PATCH',
        body: { isActive: !branch.isActive },
        schema: branchSchema,
        ifMatch: branch.version,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['branches'] }),
  });

  const rows = branches.data?.items ?? [];
  return (
    <>
      <SettingsHeader
        title={term('branch', true)}
        description="Campuses or sites. Front-desk staff can be limited to one, and receipt numbers can count per branch."
        action={
          editing === null ? (
            <Button onClick={() => setEditing('new')}>Add {term('branch').toLowerCase()}</Button>
          ) : null
        }
      />
      {editing !== null ? (
        <BranchForm
          key={editing === 'new' ? 'new' : editing.id}
          editing={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}
      {toggle.error ? <Alert tone="error">{errorMessage(toggle.error)}</Alert> : null}
      {branches.error ? <Alert tone="error">{errorMessage(branches.error)}</Alert> : null}
      <SimpleTable
        head={['Code', 'Name', 'Contact', 'Status', '']}
        empty={!branches.isPending && rows.length === 0 ? 'None yet.' : null}
      >
        {rows.map((branch) => (
          <tr key={branch.id}>
            <td className="px-4 py-3 font-mono text-xs">{branch.code}</td>
            <td className="px-4 py-3 font-medium">{branch.name}</td>
            <td className="text-muted-foreground px-4 py-3">
              {[branch.address, branch.phone].filter(Boolean).join(' · ') || '—'}
            </td>
            <td className="px-4 py-3">
              <Badge tone={branch.isActive ? 'success' : 'neutral'}>
                {branch.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <Button variant="ghost" className="h-8 px-3" onClick={() => setEditing(branch)}>
                Edit
              </Button>
              <Button
                variant="ghost"
                className="h-8 px-3"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(branch)}
              >
                {branch.isActive ? 'Deactivate' : 'Activate'}
              </Button>
            </td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}
