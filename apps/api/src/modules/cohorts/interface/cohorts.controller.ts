import {
  type ClassSessionListResponse,
  classSessionListResponseSchema,
  type Cohort,
  type CohortListQuery,
  type CohortListResponse,
  cohortListQuerySchema,
  cohortListResponseSchema,
  cohortSchema,
  type CreateCohortRequest,
  createCohortRequestSchema,
  type EnrollRequest,
  type EnrollResponse,
  enrollRequestSchema,
  enrollResponseSchema,
  type EnrollmentListQuery,
  type EnrollmentListResponse,
  enrollmentListQuerySchema,
  enrollmentListResponseSchema,
  enrollmentSchema,
  type Enrollment,
  type InstructorListResponse,
  instructorListResponseSchema,
  type RecordResultRequest,
  recordResultRequestSchema,
  type SetCohortStatusRequest,
  setCohortStatusRequestSchema,
  type UpdateCohortRequest,
  updateCohortRequestSchema,
  type WithdrawRequest,
  type WithdrawResponse,
  withdrawRequestSchema,
  withdrawResponseSchema,
} from '@emis/contracts';
import type { Grant } from '@emis/permissions';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentGrants, RequirePermission } from '../../../common/authz/decorators.js';
import { ApiIfMatch, IfMatchVersion } from '../../../common/http/versioning.js';
import { Idempotent } from '../../../common/idempotency/idempotent.decorator.js';
import { ApiZodBody, ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { type AuthContext, CurrentAuth } from '../../identity/index.js';
import { CohortsService } from '../application/cohorts.service.js';
import { EnrollmentsService } from '../application/enrollments.service.js';

const uuid = new ParseUUIDPipe({ version: '7' });
const actorOf = (auth: AuthContext) => ({
  userId: auth.userId,
  email: auth.email,
  sessionId: auth.sessionId,
});

@ApiTags('cohorts')
@Controller('cohorts')
export class CohortsController {
  constructor(private readonly cohorts: CohortsService) {}

  @Get()
  @RequirePermission('cohorts.read')
  @ApiOperation({ summary: 'Cohorts, latest start first, with seats left and waitlist size' })
  @ApiZodResponse(200, cohortListResponseSchema)
  list(
    @Query(new ZodValidationPipe(cohortListQuerySchema)) query: CohortListQuery,
    @CurrentGrants() grants: Grant[],
  ): Promise<CohortListResponse> {
    return this.cohorts.list(query, grants);
  }

  // Declared before `:id` so "instructors" isn't read as an id.
  @Get('instructors')
  @RequirePermission('cohorts.read')
  @ApiOperation({ summary: 'Active staff who can be assigned as an instructor' })
  @ApiZodResponse(200, instructorListResponseSchema)
  async instructors(): Promise<InstructorListResponse> {
    return { items: await this.cohorts.instructors() };
  }

  @Get(':id')
  @RequirePermission('cohorts.read')
  @ApiZodResponse(200, cohortSchema)
  get(@Param('id', uuid) id: string, @CurrentGrants() grants: Grant[]): Promise<Cohort> {
    return this.cohorts.get(id, grants);
  }

  @Get(':id/sessions')
  @RequirePermission('cohorts.read')
  @ApiOperation({ summary: "The cohort's timetable: every class meeting, in order" })
  @ApiZodResponse(200, classSessionListResponseSchema)
  async sessions(
    @Param('id', uuid) id: string,
    @CurrentGrants() grants: Grant[],
  ): Promise<ClassSessionListResponse> {
    return { items: await this.cohorts.sessions(id, grants) };
  }

  @Post()
  @RequirePermission('cohorts.manage')
  @Idempotent({ required: false })
  @ApiOperation({
    summary:
      'Create a cohort and generate its sessions. 409 if the room or instructor is already booked.',
  })
  @ApiZodBody(createCohortRequestSchema)
  @ApiZodResponse(201, cohortSchema)
  create(
    @Body(new ZodValidationPipe(createCohortRequestSchema)) body: CreateCohortRequest,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Cohort> {
    return this.cohorts.create(createCohortRequestSchema.parse(body), grants, actorOf(auth));
  }

  @Patch(':id')
  @RequirePermission('cohorts.manage')
  @ApiOperation({ summary: 'Change a cohort; a new schedule regenerates its sessions' })
  @ApiIfMatch()
  @ApiZodBody(updateCohortRequestSchema)
  @ApiZodResponse(200, cohortSchema)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateCohortRequestSchema)) body: UpdateCohortRequest,
    @IfMatchVersion() version: number,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Cohort> {
    return this.cohorts.update(
      id,
      updateCohortRequestSchema.parse(body),
      version,
      grants,
      actorOf(auth),
    );
  }

  @Post(':id/status')
  @RequirePermission('cohorts.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Open, start, finish or cancel a cohort' })
  @ApiIfMatch()
  @ApiZodBody(setCohortStatusRequestSchema)
  @ApiZodResponse(200, cohortSchema)
  setStatus(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(setCohortStatusRequestSchema)) body: SetCohortStatusRequest,
    @IfMatchVersion() version: number,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Cohort> {
    return this.cohorts.setStatus(id, body.status, version, grants, actorOf(auth));
  }
}

@ApiTags('enrollments')
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get()
  @RequirePermission('enrollments.read')
  @ApiOperation({ summary: 'Enrollments and waitlists (?cohortId=, ?studentId=, ?status=)' })
  @ApiZodResponse(200, enrollmentListResponseSchema)
  list(
    @Query(new ZodValidationPipe(enrollmentListQuerySchema)) query: EnrollmentListQuery,
    @CurrentGrants() grants: Grant[],
  ): Promise<EnrollmentListResponse> {
    return this.enrollments.list(query, grants);
  }

  @Post()
  @RequirePermission('enrollments.manage')
  @Idempotent()
  @ApiOperation({
    summary:
      'Enroll a student. Takes a seat if one is free, otherwise joins the waitlist (outcome says which).',
  })
  @ApiZodBody(enrollRequestSchema)
  @ApiZodResponse(201, enrollResponseSchema)
  enroll(
    @Body(new ZodValidationPipe(enrollRequestSchema)) body: EnrollRequest,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<EnrollResponse> {
    return this.enrollments.enroll(body, grants, actorOf(auth));
  }

  @Post(':id/withdraw')
  @RequirePermission('enrollments.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Withdraw a student; the longest-waiting student takes the freed seat' })
  @ApiIfMatch()
  @ApiZodBody(withdrawRequestSchema)
  @ApiZodResponse(200, withdrawResponseSchema)
  withdraw(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(withdrawRequestSchema)) body: WithdrawRequest,
    @IfMatchVersion() version: number,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<WithdrawResponse> {
    return this.enrollments.withdraw(id, body, version, grants, actorOf(auth));
  }

  @Post(':id/result')
  @RequirePermission('results.record')
  @HttpCode(200)
  @ApiOperation({
    summary: "Record the final result; the course's completion rules decide pass or fail",
  })
  @ApiIfMatch()
  @ApiZodBody(recordResultRequestSchema)
  @ApiZodResponse(200, enrollmentSchema)
  result(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(recordResultRequestSchema)) body: RecordResultRequest,
    @IfMatchVersion() version: number,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Enrollment> {
    return this.enrollments.recordResult(
      id,
      recordResultRequestSchema.parse(body),
      version,
      grants,
      actorOf(auth),
    );
  }
}
