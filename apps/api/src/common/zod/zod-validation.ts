import { type ArgumentMetadata, BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ProblemFieldError } from '@emis/contracts';
import type { z } from 'zod';

/** Thrown when a request fails Zod validation; rendered as a 400 problem with field errors. */
export class ZodValidationException extends BadRequestException {
  readonly fieldErrors: ProblemFieldError[];

  constructor(error: z.ZodError) {
    super({ code: 'VALIDATION_FAILED', message: 'The request contains invalid fields.' });
    this.fieldErrors = error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
      code: issue.code,
    }));
  }
}

export interface ZodDtoClass<TSchema extends z.ZodType = z.ZodType> {
  new (): z.output<TSchema>;
  readonly zodSchema: TSchema;
}

/**
 * Turn a contract schema into a class Nest can use as a parameter type:
 *
 *   class CreateRoomDto extends zodDto(createRoomSchema) {}
 *   create(@Body() body: CreateRoomDto) { … }   // validated by the global ZodValidationPipe
 */
export function zodDto<TSchema extends z.ZodType>(schema: TSchema): ZodDtoClass<TSchema> {
  class ZodDto {
    static readonly zodSchema = schema;
  }
  return ZodDto as unknown as ZodDtoClass<TSchema>;
}

function hasZodSchema(metatype: unknown): metatype is { zodSchema: z.ZodType } {
  return typeof metatype === 'function' && 'zodSchema' in metatype;
}

/**
 * Validates and transforms any @Body/@Query/@Param typed with a `zodDto` class, or with an
 * explicit schema: `@Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery`.
 * Parameters without a schema pass through untouched. Registered globally in AppModule.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema?: z.ZodType) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const schema =
      this.schema ?? (hasZodSchema(metadata.metatype) ? metadata.metatype.zodSchema : undefined);
    if (!schema) return value;

    const result = schema.safeParse(value);
    if (!result.success) throw new ZodValidationException(result.error);
    return result.data;
  }
}
