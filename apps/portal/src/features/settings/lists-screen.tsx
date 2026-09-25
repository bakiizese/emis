'use client';

import {
  createDescriptorRequestSchema,
  DESCRIPTOR_NAMESPACE_KEYS,
  DESCRIPTOR_NAMESPACES,
  type Descriptor,
  type DescriptorNamespace,
  descriptorListResponseSchema,
  descriptorSchema,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Card } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { Input } from '@emis/ui/components/input';
import { SelectField } from '@emis/ui/components/select';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

import { SettingsHeader } from './settings-nav';
import { SimpleTable } from './simple-table';

const addSchema = createDescriptorRequestSchema.omit({ namespace: true, sortOrder: true });

function AddValueForm({ namespace }: { namespace: DescriptorNamespace }) {
  const queryClient = useQueryClient();
  const idempotency = useIdempotencyKey();
  const form = useForm<z.input<typeof addSchema>, unknown, z.output<typeof addSchema>>({
    resolver: zodResolver(addSchema),
    defaultValues: { code: '', label: '' },
  });
  const { errors } = form.formState;

  const add = useMutation({
    mutationFn: (values: z.output<typeof addSchema>) => {
      const body = { ...values, namespace, sortOrder: 1000 };
      return apiRequest('/descriptors', {
        method: 'POST',
        body,
        schema: descriptorSchema,
        idempotencyKey: idempotency.keyFor(body),
      });
    },
    onSuccess: async () => {
      idempotency.reset();
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ['descriptors', namespace] });
    },
  });

  return (
    <form
      className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_auto]"
      noValidate
      onSubmit={(event) => void form.handleSubmit((values) => add.mutate(values))(event)}
    >
      <Field
        label="Label"
        placeholder="What people see"
        error={errors.label?.message}
        {...form.register('label')}
      />
      <Field
        label="Code"
        placeholder="e.g. radio_ad"
        hint="Stored on records; can't change later."
        error={errors.code?.message ?? (add.error ? errorMessage(add.error) : undefined)}
        {...form.register('code')}
      />
      <Button type="submit" className="sm:mt-7" disabled={add.isPending}>
        Add
      </Button>
    </form>
  );
}

function ValueRow({ value }: { value: Descriptor }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: (body: { label?: string; isActive?: boolean }) =>
      apiRequest(`/descriptors/${value.id}`, {
        method: 'PATCH',
        body,
        schema: descriptorSchema,
        ifMatch: value.version,
      }),
    onSuccess: async () => {
      setLabel(null);
      await queryClient.invalidateQueries({ queryKey: ['descriptors', value.namespace] });
    },
  });

  return (
    <tr>
      <td className="px-4 py-3">
        {label === null ? (
          <span className="font-medium">{value.label}</span>
        ) : (
          <Input
            aria-label="Label"
            value={label}
            maxLength={80}
            autoFocus
            onChange={(event) => setLabel(event.target.value)}
          />
        )}
        {update.error ? (
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">
            {errorMessage(update.error)}
          </p>
        ) : null}
      </td>
      <td className="text-muted-foreground px-4 py-3 font-mono text-xs">{value.code}</td>
      <td className="px-4 py-3">
        <Badge tone={value.isActive ? 'success' : 'neutral'}>
          {value.isActive ? 'In use' : 'Retired'}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {label === null ? (
          <>
            <Button variant="ghost" className="h-8 px-3" onClick={() => setLabel(value.label)}>
              Rename
            </Button>
            <Button
              variant="ghost"
              className="h-8 px-3"
              disabled={update.isPending}
              onClick={() => update.mutate({ isActive: !value.isActive })}
            >
              {value.isActive ? 'Retire' : 'Restore'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" className="h-8 px-3" onClick={() => setLabel(null)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              className="h-8 px-3"
              disabled={update.isPending || label.trim() === ''}
              onClick={() => update.mutate({ label: label.trim() })}
            >
              Save
            </Button>
          </>
        )}
      </td>
    </tr>
  );
}

export function ListsScreen() {
  const [namespace, setNamespace] = useState<DescriptorNamespace>(DESCRIPTOR_NAMESPACE_KEYS[0]!);
  const values = useQuery({
    queryKey: ['descriptors', namespace],
    queryFn: () =>
      apiRequest(`/descriptors?namespace=${namespace}`, { schema: descriptorListResponseSchema }),
  });
  const rows = values.data?.items ?? [];

  return (
    <>
      <SettingsHeader
        title="Dropdown lists"
        description="The choices staff pick from on forms. Retired values stay on old records but can't be picked any more."
      />
      <SelectField
        label="List"
        className="max-w-sm"
        value={namespace}
        onChange={(event) => setNamespace(event.target.value as DescriptorNamespace)}
      >
        {DESCRIPTOR_NAMESPACE_KEYS.map((key) => (
          <option key={key} value={key}>
            {DESCRIPTOR_NAMESPACES[key].name}
          </option>
        ))}
      </SelectField>
      <p className="text-muted-foreground text-sm">
        {DESCRIPTOR_NAMESPACES[namespace].description}
      </p>
      <Card>
        <AddValueForm key={namespace} namespace={namespace} />
      </Card>
      {values.error ? <Alert tone="error">{errorMessage(values.error)}</Alert> : null}
      <SimpleTable
        head={['Label', 'Code', 'Status', '']}
        empty={!values.isPending && rows.length === 0 ? 'No values yet.' : null}
      >
        {rows.map((value) => (
          <ValueRow key={`${value.id}:${value.version}`} value={value} />
        ))}
      </SimpleTable>
    </>
  );
}
