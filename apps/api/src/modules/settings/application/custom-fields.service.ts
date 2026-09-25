import {
  type CreateCustomFieldRequest,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type CustomFieldType,
  customFieldValuesSchema,
  type UpdateCustomFieldRequest,
} from '@emis/contracts';
import { customFieldDefinitions, updateWithVersion } from '@emis/db';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { isUniqueViolation } from '../../../common/db/errors.js';
import { versionedRow } from '../../../common/http/versioning.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { ZodValidationException } from '../../../common/zod/zod-validation.js';
import { AuditService, diffChanges } from '../../audit/index.js';
import { settingsErrors } from '../domain/errors.js';

type FieldRow = typeof customFieldDefinitions.$inferSelect;

const toDefinition = (row: FieldRow): CustomFieldDefinition => ({
  id: row.id,
  entityType: row.entityType as CustomFieldEntity,
  key: row.key,
  label: row.label,
  fieldType: row.fieldType as CustomFieldType,
  options: row.options,
  required: row.required,
  helpText: row.helpText,
  isActive: row.isActive,
  sortOrder: row.sortOrder,
  version: row.version,
});

/**
 * Definitions of the extra fields an institution adds to records. Values live on each record as
 * JSON and are validated with `customFieldValuesSchema(definitions)` from @emis/contracts.
 */
@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly audit: AuditService,
  ) {}

  async list(entityType: CustomFieldEntity): Promise<CustomFieldDefinition[]> {
    const rows = await this.txHost.tx
      .select()
      .from(customFieldDefinitions)
      .where(eq(customFieldDefinitions.entityType, entityType))
      .orderBy(asc(customFieldDefinitions.sortOrder), asc(customFieldDefinitions.label));
    return rows.map(toDefinition);
  }

  /**
   * Check the custom values entered on a record against the institution's active fields for that
   * kind of record (required fields present, right types, choices from the list). Returns the
   * cleaned values; unknown or hidden fields are dropped. Failures are field errors under
   * `customFields.<key>`, like any other invalid input.
   */
  async validateValues(
    entityType: CustomFieldEntity,
    values: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const definitions = await this.list(entityType);
    const schema = z.object({ customFields: customFieldValuesSchema(definitions) });
    const result = schema.safeParse({ customFields: values });
    if (!result.success) throw new ZodValidationException(result.error);
    return result.data.customFields;
  }

  @Transactional()
  async create(
    input: Required<Omit<CreateCustomFieldRequest, 'entityType' | 'fieldType'>> &
      Pick<CustomFieldDefinition, 'entityType' | 'fieldType'>,
    actor: Actor,
  ): Promise<CustomFieldDefinition> {
    let row: FieldRow | undefined;
    try {
      [row] = await this.txHost.tx
        .insert(customFieldDefinitions)
        .values({
          ...input,
          options: input.fieldType === 'select' ? input.options : [],
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw settingsErrors.codeTaken('field');
      throw error;
    }
    if (!row) throw settingsErrors.customFieldNotFound();
    await this.audit.record({
      action: 'custom_field.created',
      entityType: 'custom_field',
      entityId: row.id,
      changes: { entityType: row.entityType, key: row.key, fieldType: row.fieldType },
    });
    return toDefinition(row);
  }

  @Transactional()
  async update(
    id: string,
    input: UpdateCustomFieldRequest,
    expectedVersion: number,
    actor: Actor,
  ): Promise<CustomFieldDefinition> {
    const [before] = await this.txHost.tx
      .select()
      .from(customFieldDefinitions)
      .where(eq(customFieldDefinitions.id, id));
    if (!before) throw settingsErrors.customFieldNotFound();
    if (input.options !== undefined) this.checkOptions(before.fieldType, input.options);

    const row = versionedRow(
      await updateWithVersion(this.txHost.tx, customFieldDefinitions, id, expectedVersion, {
        ...input,
        updatedBy: actor.userId,
      }),
      settingsErrors.customFieldNotFound,
    );
    await this.audit.record({
      action: 'custom_field.updated',
      entityType: 'custom_field',
      entityId: id,
      changes: { key: before.key, ...diffChanges(before, input) },
    });
    return toDefinition(row);
  }

  private checkOptions(fieldType: string, options: string[]): void {
    const problem =
      fieldType !== 'select' && options.length > 0
        ? 'Only list fields have choices.'
        : fieldType === 'select' && options.length < 2
          ? 'Give a list at least 2 choices.'
          : new Set(options).size !== options.length
            ? 'Choices must be unique.'
            : null;
    if (problem)
      throw new UnprocessableEntityException({ code: 'INVALID_OPTIONS', message: problem });
  }
}
