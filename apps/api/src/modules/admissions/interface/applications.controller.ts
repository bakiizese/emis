import {
  type Application,
  type ApplicationListQuery,
  type ApplicationListResponse,
  applicationListQuerySchema,
  applicationListResponseSchema,
  applicationSchema,
  type ConvertRequest,
  type ConvertResponse,
  convertRequestSchema,
  convertResponseSchema,
  type CreateApplicationRequest,
  createApplicationRequestSchema,
  type DuplicateListResponse,
  duplicateListResponseSchema,
  type PlacementRequest,
  placementRequestSchema,
  type TransitionRequest,
  transitionRequestSchema,
  type UpdateApplicationRequest,
  updateApplicationRequestSchema,
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
import { RequiresModule } from '../../settings/index.js';
import { ApplicationsService } from '../application/applications.service.js';

const uuid = new ParseUUIDPipe({ version: '7' });
const actorOf = (auth: AuthContext) => ({
  userId: auth.userId,
  email: auth.email,
  sessionId: auth.sessionId,
});

@ApiTags('admissions')
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  @RequirePermission('admissions.read')
  @ApiOperation({
    summary: 'The admissions queue, newest first. Filter by ?status=, ?stage=open|closed, ?q=.',
  })
  @ApiZodResponse(200, applicationListResponseSchema)
  list(
    @Query(new ZodValidationPipe(applicationListQuerySchema)) query: ApplicationListQuery,
    @CurrentGrants() grants: Grant[],
  ): Promise<ApplicationListResponse> {
    return this.applications.list(query, grants);
  }

  @Get(':id')
  @RequirePermission('admissions.read')
  @ApiZodResponse(200, applicationSchema)
  get(@Param('id', uuid) id: string, @CurrentGrants() grants: Grant[]): Promise<Application> {
    return this.applications.get(id, grants);
  }

  @Get(':id/duplicates')
  @RequirePermission('admissions.read')
  @ApiOperation({ summary: 'Existing students who may be this applicant' })
  @ApiZodResponse(200, duplicateListResponseSchema)
  async duplicates(
    @Param('id', uuid) id: string,
    @CurrentGrants() grants: Grant[],
  ): Promise<DuplicateListResponse> {
    return { items: await this.applications.findDuplicates(id, grants) };
  }

  @Post()
  @RequirePermission('admissions.manage')
  @Idempotent()
  @ApiOperation({ summary: 'Register a walk-in applicant' })
  @ApiZodBody(createApplicationRequestSchema)
  @ApiZodResponse(201, applicationSchema)
  create(
    @Body(new ZodValidationPipe(createApplicationRequestSchema)) body: CreateApplicationRequest,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Application> {
    return this.applications.create(
      createApplicationRequestSchema.parse(body),
      grants,
      actorOf(auth),
    );
  }

  @Patch(':id')
  @RequirePermission('admissions.manage')
  @ApiOperation({ summary: 'Edit an application that is still open' })
  @ApiIfMatch()
  @ApiZodBody(updateApplicationRequestSchema)
  @ApiZodResponse(200, applicationSchema)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateApplicationRequestSchema)) body: UpdateApplicationRequest,
    @IfMatchVersion() version: number,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Application> {
    return this.applications.update(
      id,
      updateApplicationRequestSchema.parse(body),
      version,
      grants,
      actorOf(auth),
    );
  }

  @Post(':id/transition')
  @RequirePermission('admissions.manage')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Move the application to another stage (contacted, offered, rejected…)',
  })
  @ApiIfMatch()
  @ApiZodBody(transitionRequestSchema)
  @ApiZodResponse(200, applicationSchema)
  transition(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(transitionRequestSchema)) body: TransitionRequest,
    @IfMatchVersion() version: number,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Application> {
    return this.applications.transition(id, body.to, version, grants, actorOf(auth));
  }

  @Post(':id/placement')
  @RequirePermission('placement.record')
  @RequiresModule('placement')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record the placement result and the level to start at' })
  @ApiIfMatch()
  @ApiZodBody(placementRequestSchema)
  @ApiZodResponse(200, applicationSchema)
  placement(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(placementRequestSchema)) body: PlacementRequest,
    @IfMatchVersion() version: number,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Application> {
    return this.applications.recordPlacement(
      id,
      placementRequestSchema.parse(body),
      version,
      grants,
      actorOf(auth),
    );
  }

  @Post(':id/convert')
  @RequirePermission('admissions.manage')
  @Idempotent()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Register an offered applicant as a student (or link an existing one) and confirm the application',
  })
  @ApiIfMatch()
  @ApiZodBody(convertRequestSchema)
  @ApiZodResponse(200, convertResponseSchema)
  convert(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(convertRequestSchema)) body: ConvertRequest,
    @IfMatchVersion() version: number,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<ConvertResponse> {
    return this.applications.convert(
      id,
      convertRequestSchema.parse(body),
      version,
      grants,
      actorOf(auth),
    );
  }
}
