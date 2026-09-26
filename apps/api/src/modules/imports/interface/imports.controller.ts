import {
  type StudentImportRequest,
  type StudentImportResult,
  studentImportRequestSchema,
  studentImportResultSchema,
} from '@emis/contracts';
import type { Grant } from '@emis/permissions';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentGrants, RequirePermission } from '../../../common/authz/decorators.js';
import { Idempotent } from '../../../common/idempotency/idempotent.decorator.js';
import { ApiZodBody, ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { type AuthContext, CurrentAuth } from '../../identity/index.js';
import { StudentImportService } from '../application/student-import.service.js';

const actorOf = (auth: AuthContext) => ({
  userId: auth.userId,
  email: auth.email,
  sessionId: auth.sessionId,
});

@ApiTags('imports')
@Controller('imports/students')
export class ImportsController {
  constructor(private readonly imports: StudentImportService) {}

  @Post('preview')
  @HttpCode(200)
  @RequirePermission('students.import')
  @ApiOperation({
    summary:
      'Dry run: what importing this CSV would do, row by row. Nothing is saved and no student numbers are used.',
  })
  @ApiZodBody(studentImportRequestSchema)
  @ApiZodResponse(200, studentImportResultSchema)
  preview(
    @Body(new ZodValidationPipe(studentImportRequestSchema)) body: StudentImportRequest,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<StudentImportResult> {
    return this.imports.preview(studentImportRequestSchema.parse(body), grants, actorOf(auth));
  }

  @Post()
  @RequirePermission('students.import')
  @Idempotent()
  @ApiOperation({
    summary:
      'Import students from a CSV. Rows with problems and likely duplicates are skipped and reported; the rest are added. Safe to retry.',
  })
  @ApiZodBody(studentImportRequestSchema)
  @ApiZodResponse(201, studentImportResultSchema)
  commit(
    @Body(new ZodValidationPipe(studentImportRequestSchema)) body: StudentImportRequest,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<StudentImportResult> {
    return this.imports.commit(studentImportRequestSchema.parse(body), grants, actorOf(auth));
  }
}
