import {
  type CreateProgramRequest,
  createProgramRequestSchema,
  type Course,
  type CourseListQuery,
  type CourseListResponse,
  courseListQuerySchema,
  courseListResponseSchema,
  courseSchema,
  type CreateCourseRequest,
  createCourseRequestSchema,
  type Program,
  type ProgramListQuery,
  type ProgramListResponse,
  programListQuerySchema,
  programListResponseSchema,
  programSchema,
  type SetCoursePrerequisitesRequest,
  setCoursePrerequisitesRequestSchema,
  type UpdateCourseRequest,
  updateCourseRequestSchema,
  type UpdateProgramRequest,
  updateProgramRequestSchema,
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
import { CoursesService } from '../application/courses.service.js';
import { ProgramsService } from '../application/programs.service.js';
import { actorOf } from './actor.js';

const uuid = new ParseUUIDPipe({ version: '7' });

@ApiTags('catalog')
@Controller('programs')
export class ProgramsController {
  constructor(private readonly programs: ProgramsService) {}

  @Get()
  @RequirePermission('catalog.read')
  @ApiOperation({ summary: 'Programs, optionally for one department (?departmentId=)' })
  @ApiZodResponse(200, programListResponseSchema)
  async list(
    @Query(new ZodValidationPipe(programListQuerySchema)) query: ProgramListQuery,
  ): Promise<ProgramListResponse> {
    return { items: await this.programs.list(query) };
  }

  @Get(':id')
  @RequirePermission('catalog.read')
  @ApiZodResponse(200, programSchema)
  get(@Param('id', uuid) id: string): Promise<Program> {
    return this.programs.get(id);
  }

  @Post()
  @RequirePermission('catalog.manage')
  @Idempotent({ required: false })
  @ApiOperation({ summary: 'Create a program under a department you manage' })
  @ApiZodBody(createProgramRequestSchema)
  @ApiZodResponse(201, programSchema)
  create(
    @Body(new ZodValidationPipe(createProgramRequestSchema)) body: CreateProgramRequest,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Program> {
    return this.programs.create(createProgramRequestSchema.parse(body), grants, actorOf(auth));
  }

  @Patch(':id')
  @RequirePermission('catalog.manage')
  @ApiOperation({ summary: 'Rename, describe, reorder or publish a program. Its code is fixed.' })
  @ApiIfMatch()
  @ApiZodBody(updateProgramRequestSchema)
  @ApiZodResponse(200, programSchema)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateProgramRequestSchema)) body: UpdateProgramRequest,
    @IfMatchVersion() version: number,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Program> {
    return this.programs.update(
      id,
      updateProgramRequestSchema.parse(body),
      version,
      grants,
      actorOf(auth),
    );
  }
}

@ApiTags('catalog')
@Controller('courses')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  @RequirePermission('catalog.read')
  @ApiOperation({ summary: 'Courses (levels) of one program, in level order (?programId=)' })
  @ApiZodResponse(200, courseListResponseSchema)
  async list(
    @Query(new ZodValidationPipe(courseListQuerySchema)) query: CourseListQuery,
  ): Promise<CourseListResponse> {
    return { items: await this.courses.list(query.programId) };
  }

  @Get(':id')
  @RequirePermission('catalog.read')
  @ApiZodResponse(200, courseSchema)
  get(@Param('id', uuid) id: string): Promise<Course> {
    return this.courses.get(id);
  }

  @Post()
  @RequirePermission('catalog.manage')
  @Idempotent({ required: false })
  @ApiZodBody(createCourseRequestSchema)
  @ApiZodResponse(201, courseSchema)
  create(
    @Body(new ZodValidationPipe(createCourseRequestSchema)) body: CreateCourseRequest,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Course> {
    return this.courses.create(createCourseRequestSchema.parse(body), grants, actorOf(auth));
  }

  @Patch(':id')
  @RequirePermission('catalog.manage')
  @ApiOperation({ summary: 'Change a course, including its completion rules. Its code is fixed.' })
  @ApiIfMatch()
  @ApiZodBody(updateCourseRequestSchema)
  @ApiZodResponse(200, courseSchema)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateCourseRequestSchema)) body: UpdateCourseRequest,
    @IfMatchVersion() version: number,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Course> {
    return this.courses.update(
      id,
      updateCourseRequestSchema.parse(body),
      version,
      grants,
      actorOf(auth),
    );
  }

  @Put(':id/prerequisites')
  @RequirePermission('catalog.manage')
  @ApiOperation({
    summary: 'Replace the courses that must be completed first (same program, no loops)',
  })
  @ApiIfMatch()
  @ApiZodBody(setCoursePrerequisitesRequestSchema)
  @ApiZodResponse(200, courseSchema)
  setPrerequisites(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(setCoursePrerequisitesRequestSchema))
    body: SetCoursePrerequisitesRequest,
    @IfMatchVersion() version: number,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Course> {
    return this.courses.setPrerequisites(id, body.courseIds, version, grants, actorOf(auth));
  }
}
