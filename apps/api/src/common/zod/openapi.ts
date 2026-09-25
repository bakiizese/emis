import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiResponse, type OpenAPIObject } from '@nestjs/swagger';
import { z } from 'zod';

type ComponentSchema = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
/** OpenAPI schema object (swagger doesn't export the type from its package root). */
export type SchemaObject = Exclude<ComponentSchema, { $ref: string }>;

/** Contract schema → OpenAPI 3 schema object, so docs are generated from the same Zod source. */
export function toOpenApiSchema(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    unrepresentable: 'any',
    io: 'output',
  }) as SchemaObject;
}

export function ApiZodResponse(status: number, schema: z.ZodType, description?: string) {
  return ApiResponse({ status, description, schema: toOpenApiSchema(schema) });
}

export function ApiZodBody(schema: z.ZodType, description?: string) {
  return applyDecorators(
    ApiBody({
      description,
      schema: z.toJSONSchema(schema, {
        target: 'openapi-3.0',
        unrepresentable: 'any',
        io: 'input',
      }) as SchemaObject,
    }),
  );
}
