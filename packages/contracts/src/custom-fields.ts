import { z } from 'zod';

/** Records an institution can extend with its own fields. */
export const CUSTOM_FIELD_ENTITIES = ['student', 'application', 'staff', 'cohort'] as const;
export const customFieldEntitySchema = z.enum(CUSTOM_FIELD_ENTITIES);
export type CustomFieldEntity = z.infer<typeof customFieldEntitySchema>;

export const CUSTOM_FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'date',
  'select',
  'checkbox',
] as const;
export const customFieldTypeSchema = z.enum(CUSTOM_FIELD_TYPES);
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;

export const customFieldKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, 'Lowercase letters, digits and underscores, starting with a letter');

const optionSchema = z.string().trim().min(1).max(80);

export const customFieldDefinitionSchema = z.object({
  id: z.uuid(),
  entityType: customFieldEntitySchema,
  key: z.string(),
  label: z.string(),
  fieldType: customFieldTypeSchema,
  options: z.array(z.string()),
  required: z.boolean(),
  helpText: z.string(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  version: z.number().int(),
});
export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;

const definitionFields = {
  label: z.string().trim().min(1).max(80),
  options: z.array(optionSchema).max(50).default([]),
  required: z.boolean().default(false),
  helpText: z.string().trim().max(200).default(''),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
};

function requireOptionsForSelect(
  value: { fieldType?: CustomFieldType; options?: string[] },
  ctx: z.RefinementCtx,
) {
  if (value.fieldType === 'select' && (value.options?.length ?? 0) < 2) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: 'Give a list at least 2 choices.' });
  }
  if (value.options && new Set(value.options).size !== value.options.length) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: 'Choices must be unique.' });
  }
}

export const createCustomFieldRequestSchema = z
  .object({
    entityType: customFieldEntitySchema,
    key: customFieldKeySchema,
    fieldType: customFieldTypeSchema,
    ...definitionFields,
  })
  .superRefine(requireOptionsForSelect);
export type CreateCustomFieldRequest = z.input<typeof createCustomFieldRequestSchema>;

/** The key and type are fixed once created: stored values depend on them. */
export const updateCustomFieldRequestSchema = z
  .object({
    label: definitionFields.label,
    options: z.array(optionSchema).max(50),
    required: z.boolean(),
    helpText: z.string().trim().max(200),
    sortOrder: z.number().int().min(0).max(10_000),
    isActive: z.boolean(),
  })
  .partial();
export type UpdateCustomFieldRequest = z.infer<typeof updateCustomFieldRequestSchema>;

export const customFieldListQuerySchema = z.object({ entityType: customFieldEntitySchema });

export const customFieldListResponseSchema = z.object({
  items: z.array(customFieldDefinitionSchema),
});
export type CustomFieldListResponse = z.infer<typeof customFieldListResponseSchema>;

function valueSchema(def: Pick<CustomFieldDefinition, 'fieldType' | 'options'>): z.ZodType {
  switch (def.fieldType) {
    case 'text':
      return z.string().trim().max(500);
    case 'long_text':
      return z.string().trim().max(4000);
    case 'number':
      return z.number().finite();
    case 'date':
      return z.iso.date();
    case 'select':
      return z.enum(def.options as [string, ...string[]]);
    case 'checkbox':
      return z.boolean();
  }
}

/**
 * Validator for the custom values stored on a record (a JSON object keyed by field key). Built from
 * the active definitions; values for unknown or retired fields are dropped.
 */
export function customFieldValuesSchema(
  definitions: readonly Pick<
    CustomFieldDefinition,
    'key' | 'fieldType' | 'options' | 'required' | 'isActive'
  >[],
) {
  const shape: Record<string, z.ZodType> = {};
  for (const def of definitions) {
    if (!def.isActive) continue;
    let schema = valueSchema(def);
    if (def.fieldType === 'text' || def.fieldType === 'long_text') {
      schema = def.required ? (schema as z.ZodString).min(1, 'Required') : schema;
    }
    shape[def.key] = def.required ? schema : schema.nullish();
  }
  return z.object(shape);
}
