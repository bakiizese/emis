'use client';

import {
  CUSTOM_FIELD_ENTITIES,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  customFieldDefinitionSchema,
  customFieldKeySchema,
  customFieldListResponseSchema,
  customFieldTypeSchema,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { CheckboxField } from '@emis/ui/components/checkbox';
import { Field } from '@emis/ui/components/field';
import { SelectField } from '@emis/ui/components/select';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { useInstitution } from '@/features/institution/use-institution';
import { apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

import { SettingsHeader } from './settings-nav';
import { SimpleTable } from './simple-table';

const TYPE_LABELS: Record<z.infer<typeof customFieldTypeSchema>, string> = {
  text: 'Short text',
  long_text: 'Long text',
  number: 'Number',
  date: 'Date',
  select: 'List of choices',
  checkbox: 'Yes / no',
};

/** Choices are typed one per line and sent as an array. */
const formSchema = z.object({
  key: customFieldKeySchema,
  label: z.string().trim().min(1).max(80),
  fieldType: customFieldTypeSchema,
  choices: z.string().max(4000),
  required: z.boolean(),
  helpText: z.string().trim().max(200),
});
type FormValues = z.infer<typeof formSchema>;

const toOptions = (choices: string) =>
  choices
    .split('\n')
    .map((c) => c.trim())
    .filter(Boolean);

function FieldForm({
  entityType,
  editing,
  onDone,
}: {
  entityType: CustomFieldEntity;
  editing: CustomFieldDefinition | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const idempotency = useIdempotencyKey();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      key: editing?.key ?? '',
      label: editing?.label ?? '',
      fieldType: editing?.fieldType ?? 'text',
      choices: editing?.options.join('\n') ?? '',
      required: editing?.required ?? false,
      helpText: editing?.helpText ?? '',
    },
  });
  const { errors } = form.formState;
  const fieldType = useWatch({ control: form.control, name: 'fieldType' });

  const save = useMutation({
    mutationFn: ({ choices, key, fieldType: type, ...rest }: FormValues) => {
      const options = type === 'select' ? toOptions(choices) : [];
      if (editing) {
        return apiRequest(`/custom-fields/${editing.id}`, {
          method: 'PATCH',
          body: { ...rest, options },
          schema: customFieldDefinitionSchema,
          ifMatch: editing.version,
        });
      }
      const body = { ...rest, key, fieldType: type, options, entityType };
      return apiRequest('/custom-fields', {
        method: 'POST',
        body,
        schema: customFieldDefinitionSchema,
        idempotencyKey: idempotency.keyFor(body),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['custom-fields', entityType] });
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {editing ? `Edit ${editing.label}` : 'Add a field'}
        </CardTitle>
      </CardHeader>
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
      >
        <Field label="Label" error={errors.label?.message} {...form.register('label')} />
        <Field
          label="Key"
          readOnly={editing !== null}
          hint="Lowercase with underscores, e.g. employer_name. Fixed once created."
          error={errors.key?.message}
          {...form.register('key')}
        />
        <SelectField
          label="Type"
          disabled={editing !== null}
          error={errors.fieldType?.message}
          {...form.register('fieldType')}
        >
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <Field
          label="Help text (optional)"
          error={errors.helpText?.message}
          {...form.register('helpText')}
        />
        {fieldType === 'select' ? (
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="choices" className="text-sm font-medium">
              Choices, one per line
            </label>
            <textarea
              id="choices"
              rows={4}
              className="border-border bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
              {...form.register('choices')}
            />
          </div>
        ) : null}
        <CheckboxField
          label="Required"
          description="Staff can't save the record without it."
          {...form.register('required')}
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

export function CustomFieldsScreen() {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const [entityType, setEntityType] = useState<CustomFieldEntity>('student');
  const [editing, setEditing] = useState<CustomFieldDefinition | 'new' | null>(null);
  const fields = useQuery({
    queryKey: ['custom-fields', entityType],
    queryFn: () =>
      apiRequest(`/custom-fields?entityType=${entityType}`, {
        schema: customFieldListResponseSchema,
      }),
  });
  const toggle = useMutation({
    mutationFn: (field: CustomFieldDefinition) =>
      apiRequest(`/custom-fields/${field.id}`, {
        method: 'PATCH',
        body: { isActive: !field.isActive },
        schema: customFieldDefinitionSchema,
        ifMatch: field.version,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['custom-fields', entityType] }),
  });

  const entityName = (entity: CustomFieldEntity) =>
    entity === 'student' || entity === 'cohort'
      ? term(entity, true)
      : entity === 'application'
        ? 'Applications'
        : 'Staff';
  const rows = fields.data?.items ?? [];

  return (
    <>
      <SettingsHeader
        title="Custom fields"
        description="Extra information you want to keep on records, beyond the built-in fields."
        action={
          editing === null ? <Button onClick={() => setEditing('new')}>Add field</Button> : null
        }
      />
      <SelectField
        label="Records"
        className="max-w-sm"
        value={entityType}
        onChange={(event) => {
          setEditing(null);
          setEntityType(event.target.value as CustomFieldEntity);
        }}
      >
        {CUSTOM_FIELD_ENTITIES.map((entity) => (
          <option key={entity} value={entity}>
            {entityName(entity)}
          </option>
        ))}
      </SelectField>
      {editing !== null ? (
        <FieldForm
          key={editing === 'new' ? `new:${entityType}` : editing.id}
          entityType={entityType}
          editing={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}
      {toggle.error ? <Alert tone="error">{errorMessage(toggle.error)}</Alert> : null}
      {fields.error ? <Alert tone="error">{errorMessage(fields.error)}</Alert> : null}
      <SimpleTable
        head={['Label', 'Type', 'Status', '']}
        empty={!fields.isPending && rows.length === 0 ? 'No custom fields yet.' : null}
      >
        {rows.map((field) => (
          <tr key={field.id}>
            <td className="px-4 py-3">
              <div className="font-medium">
                {field.label}
                {field.required ? <span className="text-muted-foreground"> · required</span> : null}
              </div>
              <div className="text-muted-foreground font-mono text-xs">{field.key}</div>
            </td>
            <td className="px-4 py-3">
              {TYPE_LABELS[field.fieldType]}
              {field.fieldType === 'select' ? (
                <div className="text-muted-foreground text-xs">{field.options.join(', ')}</div>
              ) : null}
            </td>
            <td className="px-4 py-3">
              <Badge tone={field.isActive ? 'success' : 'neutral'}>
                {field.isActive ? 'In use' : 'Hidden'}
              </Badge>
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <Button variant="ghost" className="h-8 px-3" onClick={() => setEditing(field)}>
                Edit
              </Button>
              <Button
                variant="ghost"
                className="h-8 px-3"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(field)}
              >
                {field.isActive ? 'Hide' : 'Show'}
              </Button>
            </td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}
