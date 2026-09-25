import { describe, expect, it } from 'vitest';

import { createCustomFieldRequestSchema, customFieldValuesSchema } from './custom-fields.js';

const base = { isActive: true, options: [] as string[], required: false };

describe('custom field values', () => {
  const schema = customFieldValuesSchema([
    { ...base, key: 'employer', fieldType: 'text', required: true },
    { ...base, key: 'years', fieldType: 'number' },
    { ...base, key: 'shirt', fieldType: 'select', options: ['S', 'M', 'L'] },
    { ...base, key: 'born', fieldType: 'date' },
    { ...base, key: 'agreed', fieldType: 'checkbox' },
    { ...base, key: 'retired', fieldType: 'text', isActive: false },
  ]);

  it('accepts valid values and drops unknown or retired fields', () => {
    expect(
      schema.parse({ employer: ' Ethio Telecom ', years: 3, shirt: 'M', retired: 'x', junk: 1 }),
    ).toEqual({ employer: 'Ethio Telecom', years: 3, shirt: 'M' });
  });

  it('enforces required fields, types and choices', () => {
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ employer: '' }).success).toBe(false);
    expect(schema.safeParse({ employer: 'A', years: 'three' }).success).toBe(false);
    expect(schema.safeParse({ employer: 'A', shirt: 'XXL' }).success).toBe(false);
    expect(schema.safeParse({ employer: 'A', born: '2026-13-01' }).success).toBe(false);
    expect(schema.safeParse({ employer: 'A', agreed: 'yes' }).success).toBe(false);
  });

  it('lets optional fields be empty', () => {
    expect(schema.safeParse({ employer: 'A', years: null, born: undefined }).success).toBe(true);
  });
});

describe('custom field definitions', () => {
  it('needs at least two unique choices for a list', () => {
    const field = { entityType: 'student', key: 'shirt', label: 'Shirt', fieldType: 'select' };
    expect(createCustomFieldRequestSchema.safeParse({ ...field, options: ['S'] }).success).toBe(
      false,
    );
    expect(
      createCustomFieldRequestSchema.safeParse({ ...field, options: ['S', 'S'] }).success,
    ).toBe(false);
    expect(
      createCustomFieldRequestSchema.safeParse({ ...field, options: ['S', 'M'] }).success,
    ).toBe(true);
  });
});
