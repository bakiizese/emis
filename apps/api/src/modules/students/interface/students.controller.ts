import {
  type CreateStudentRequest,
  createStudentRequestSchema,
  type DuplicateListResponse,
  type DuplicateQuery,
  duplicateListResponseSchema,
  duplicateQuerySchema,
  type SetGuardiansRequest,
  setGuardiansRequestSchema,
  type Student,
  type StudentListQuery,
  type StudentListResponse,
  studentListQuerySchema,
  studentListResponseSchema,
  studentSchema,
  type UpdateStudentRequest,
  updateStudentRequestSchema,
} from '@emis/contracts';
import type { Grant } from '@emis/permissions';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentGrants, RequirePermission } from '../../../common/authz/decorators.js';
import { ApiIfMatch, IfMatchVersion } from '../../../common/http/versioning.js';
import { Idempotent } from '../../../common/idempotency/idempotent.decorator.js';
import { ApiZodBody, ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { type AuthContext, CurrentAuth } from '../../identity/index.js';
import { DuplicatesService } from '../application/duplicates.service.js';
import { StudentsService } from '../application/students.service.js';

const uuid = new ParseUUIDPipe({ version: '7' });
const actorOf = (auth: AuthContext) => ({
  userId: auth.userId,
  email: auth.email,
  sessionId: auth.sessionId,
});

@ApiTags('students')
@Controller('students')
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly duplicates: DuplicatesService,
  ) {}

  @Get()
  @RequirePermission('students.read')
  @ApiOperation({
    summary: 'Students, newest first. ?q= matches name, student number or phone.',
  })
  @ApiZodResponse(200, studentListResponseSchema)
  list(
    @Query(new ZodValidationPipe(studentListQuerySchema)) query: StudentListQuery,
    @CurrentGrants() grants: Grant[],
  ): Promise<StudentListResponse> {
    return this.students.list(query, grants);
  }

  // Declared before `:id` so "duplicates" isn't read as an id.
  @Get('duplicates')
  @RequirePermission('students.read')
  @ApiOperation({
    summary: 'Students who may be the same person: same phone or email, or a very similar name',
  })
  @ApiZodResponse(200, duplicateListResponseSchema)
  async findDuplicates(
    @Query(new ZodValidationPipe(duplicateQuerySchema)) query: DuplicateQuery,
  ): Promise<DuplicateListResponse> {
    return { items: await this.duplicates.find(query) };
  }

  @Get(':id')
  @RequirePermission('students.read')
  @ApiZodResponse(200, studentSchema)
  get(@Param('id', uuid) id: string, @CurrentGrants() grants: Grant[]): Promise<Student> {
    return this.students.get(id, grants);
  }

  @Post()
  @RequirePermission('students.manage')
  @Idempotent()
  @ApiOperation({
    summary:
      'Register a student. Refused (409) if a likely duplicate exists, unless confirmNotDuplicate is true.',
  })
  @ApiZodBody(createStudentRequestSchema)
  @ApiZodResponse(201, studentSchema)
  create(
    @Body(new ZodValidationPipe(createStudentRequestSchema)) body: CreateStudentRequest,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Student> {
    return this.students.create(createStudentRequestSchema.parse(body), grants, actorOf(auth));
  }

  @Patch(':id')
  @RequirePermission('students.manage')
  @ApiOperation({ summary: 'Update details, category, custom fields or status' })
  @ApiIfMatch()
  @ApiZodBody(updateStudentRequestSchema)
  @ApiZodResponse(200, studentSchema)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateStudentRequestSchema)) body: UpdateStudentRequest,
    @IfMatchVersion() version: number,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Student> {
    return this.students.update(
      id,
      updateStudentRequestSchema.parse(body),
      version,
      grants,
      actorOf(auth),
    );
  }

  @Put(':id/guardians')
  @RequirePermission('students.manage')
  @ApiOperation({ summary: 'Replace the guardians and contact people' })
  @ApiIfMatch()
  @ApiZodBody(setGuardiansRequestSchema)
  @ApiZodResponse(200, studentSchema)
  setGuardians(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(setGuardiansRequestSchema)) body: SetGuardiansRequest,
    @IfMatchVersion() version: number,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Student> {
    return this.students.setGuardians(
      id,
      setGuardiansRequestSchema.parse(body).guardians,
      version,
      grants,
      actorOf(auth),
    );
  }
}
