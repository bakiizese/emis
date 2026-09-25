'use client';

import type { CustomFieldEntity } from '@emis/contracts';
import { CheckboxField } from '@emis/ui/components/checkbox';
import { Field } from '@emis/ui/components/field';
import { SelectField } from '@emis/ui/components/select';

import { useCustomFieldDefinitions } from './use-lists';

export type CustomValues = Record<string, unknown>;

/**
 * Inputs for the institution's own extra fields on a kind of record. Values are kept by the parent
 * (`values`/`onChange`) and sent with the form; `errors` are the API's messages by field key.
 */
export function CustomFieldInputs({
  entityType,
  values,
  onChange,
  errors = {},
}: {
  entityType: CustomFieldEntity;
  values: CustomValues;
  onChange: (values: CustomValues) => void;
  errors?: Record<string, string>;
}) {
  const definitions = useCustomFieldDefinitions(entityType);
  if (!definitions.data || definitions.data.length === 0) return null;

  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });
  const text = (key: string) => (typeof values[key] === 'string' ? values[key] : '');

  return (
    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-sm font-semibold">Additional information</legend>
      {definitions.data.map((def) => {
        const label = def.required ? def.label : `${def.label} (optional)`;
        const error = errors[def.key];
        switch (def.fieldType) {
          case 'checkbox':
            return (
              <CheckboxField
                key={def.key}
                label={def.label}
                description={def.helpText || undefined}
                checked={values[def.key] === true}
                onChange={(event) => set(def.key, event.target.checked)}
              />
            );
          case 'select':
            return (
              <SelectField
                key={def.key}
                label={label}
                error={error}
                value={text(def.key)}
                onChange={(event) => set(def.key, event.target.value || null)}
              >
                <option value="">Choose…</option>
                {def.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </SelectField>
            );
          case 'number':
            return (
              <Field
                key={def.key}
                label={label}
                type="number"
                hint={def.helpText || undefined}
                error={error}
                value={typeof values[def.key] === 'number' ? String(values[def.key]) : ''}
                onChange={(event) =>
                  set(def.key, event.target.value === '' ? null : Number(event.target.value))
                }
              />
            );
          case 'text':
          case 'long_text':
          case 'date':
            return (
              <Field
                key={def.key}
                label={label}
                type={def.fieldType === 'date' ? 'date' : 'text'}
                hint={def.helpText || undefined}
                error={error}
                value={text(def.key)}
                onChange={(event) =>
                  set(def.key, event.target.value === '' ? null : event.target.value)
                }
              />
            );
        }
      })}
    </fieldset>
  );
}

/** "customFields.employer" → { employer: message }, from an ApiError's field errors. */
export function customFieldErrors(
  fieldErrors: { path: string; message: string }[] = [],
): Record<string, string> {
  return Object.fromEntries(
    fieldErrors
      .filter((e) => e.path.startsWith('customFields.'))
      .map((e) => [e.path.slice('customFields.'.length), e.message]),
  );
}
