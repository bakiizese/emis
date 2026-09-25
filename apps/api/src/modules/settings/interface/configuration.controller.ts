import {
  type CreateCustomFieldRequest,
  createCustomFieldRequestSchema,
  type CreateDescriptorRequest,
  createDescriptorRequestSchema,
  type CustomFieldDefinition,
  customFieldDefinitionSchema,
  customFieldListQuerySchema,
  type CustomFieldListResponse,
  customFieldListResponseSchema,
  type Descriptor,
  descriptorListQuerySchema,
  type DescriptorListResponse,
  descriptorListResponseSchema,
  descriptorSchema,
  type ModuleListResponse,
  moduleListResponseSchema,
  type NumberSeriesListResponse,
  numberSeriesListResponseSchema,
  type SetModuleRequest,
  setModuleRequestSchema,
  type SetNumberSeriesRequest,
  setNumberSeriesRequestSchema,
  type SetTerminologyRequest,
  setTerminologyRequestSchema,
  type TerminologyResponse,
  terminologyResponseSchema,
  type UpdateCustomFieldRequest,
  updateCustomFieldRequestSchema,
  type UpdateDescriptorRequest,
  updateDescriptorRequestSchema,
} from '@emis/contracts';
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
import type { z } from 'zod';

import { RequirePermission } from '../../../common/authz/decorators.js';
import { Idempotent } from '../../../common/idempotency/idempotent.decorator.js';
import { ApiIfMatch, IfMatchVersion } from '../../../common/http/versioning.js';
import { ApiZodBody, ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { type AuthContext, CurrentAuth } from '../../identity/index.js';
import { CustomFieldsService } from '../application/custom-fields.service.js';
import { DescriptorsService } from '../application/descriptors.service.js';
import { ModulesService } from '../application/modules.service.js';
import { NumberingService } from '../application/numbering.service.js';
import { TerminologyService } from '../application/terminology.service.js';
import { actorOf } from './actor.js';

const uuid = new ParseUUIDPipe({ version: '7' });

@ApiTags('settings')
@Controller('modules')
export class ModulesController {
  constructor(private readonly modules: ModulesService) {}

  @Get()
  @RequirePermission('settings.read')
  @ApiOperation({ summary: 'Optional features and whether each is switched on' })
  @ApiZodResponse(200, moduleListResponseSchema)
  async list(): Promise<ModuleListResponse> {
    return { items: await this.modules.states() };
  }

  @Put(':key')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Switch a module on or off (respecting what it depends on)' })
  @ApiZodBody(setModuleRequestSchema)
  @ApiZodResponse(200, moduleListResponseSchema)
  async set(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(setModuleRequestSchema)) body: SetModuleRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ModuleListResponse> {
    return { items: await this.modules.set(key, body.enabled, actorOf(auth)) };
  }
}

@ApiTags('settings')
@Controller('descriptors')
export class DescriptorsController {
  constructor(private readonly descriptors: DescriptorsService) {}

  @Get()
  @RequirePermission('settings.read')
  @ApiOperation({ summary: 'Values of one dropdown list, e.g. ?namespace=lead_source' })
  @ApiZodResponse(200, descriptorListResponseSchema)
  async list(
    @Query(new ZodValidationPipe(descriptorListQuerySchema))
    query: z.infer<typeof descriptorListQuerySchema>,
  ): Promise<DescriptorListResponse> {
    return { items: await this.descriptors.list(query.namespace) };
  }

  @Post()
  @RequirePermission('settings.manage')
  @Idempotent({ required: false })
  @ApiZodBody(createDescriptorRequestSchema)
  @ApiZodResponse(201, descriptorSchema)
  create(
    @Body(new ZodValidationPipe(createDescriptorRequestSchema)) body: CreateDescriptorRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Descriptor> {
    return this.descriptors.create(createDescriptorRequestSchema.parse(body), actorOf(auth));
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Relabel, reorder or retire a value. The code is fixed.' })
  @ApiIfMatch()
  @ApiZodBody(updateDescriptorRequestSchema)
  @ApiZodResponse(200, descriptorSchema)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateDescriptorRequestSchema)) body: UpdateDescriptorRequest,
    @IfMatchVersion() version: number,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Descriptor> {
    return this.descriptors.update(id, body, version, actorOf(auth));
  }
}

@ApiTags('settings')
@Controller('custom-fields')
export class CustomFieldsController {
  constructor(private readonly fields: CustomFieldsService) {}

  @Get()
  @RequirePermission('settings.read')
  @ApiOperation({
    summary: 'Extra fields defined for one kind of record, e.g. ?entityType=student',
  })
  @ApiZodResponse(200, customFieldListResponseSchema)
  async list(
    @Query(new ZodValidationPipe(customFieldListQuerySchema))
    query: z.infer<typeof customFieldListQuerySchema>,
  ): Promise<CustomFieldListResponse> {
    return { items: await this.fields.list(query.entityType) };
  }

  @Post()
  @RequirePermission('settings.manage')
  @Idempotent({ required: false })
  @ApiZodBody(createCustomFieldRequestSchema)
  @ApiZodResponse(201, customFieldDefinitionSchema)
  create(
    @Body(new ZodValidationPipe(createCustomFieldRequestSchema)) body: CreateCustomFieldRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<CustomFieldDefinition> {
    return this.fields.create(createCustomFieldRequestSchema.parse(body), actorOf(auth));
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Change a field. Its key and type are fixed once created.' })
  @ApiIfMatch()
  @ApiZodBody(updateCustomFieldRequestSchema)
  @ApiZodResponse(200, customFieldDefinitionSchema)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateCustomFieldRequestSchema)) body: UpdateCustomFieldRequest,
    @IfMatchVersion() version: number,
    @CurrentAuth() auth: AuthContext,
  ): Promise<CustomFieldDefinition> {
    return this.fields.update(id, body, version, actorOf(auth));
  }
}

@ApiTags('settings')
@Controller('terminology')
export class TerminologyController {
  constructor(private readonly terminology: TerminologyService) {}

  @Get()
  @RequirePermission('settings.read')
  @ApiZodResponse(200, terminologyResponseSchema)
  list(): Promise<TerminologyResponse> {
    return this.terminology.list();
  }

  @Put()
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Replace the renamed words; terms left out go back to the default' })
  @ApiZodBody(setTerminologyRequestSchema)
  @ApiZodResponse(200, terminologyResponseSchema)
  set(
    @Body(new ZodValidationPipe(setTerminologyRequestSchema)) body: SetTerminologyRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<TerminologyResponse> {
    return this.terminology.set(body, actorOf(auth));
  }
}

@ApiTags('settings')
@Controller('number-series')
export class NumberSeriesController {
  constructor(private readonly numbering: NumberingService) {}

  @Get()
  @RequirePermission('settings.read')
  @ApiOperation({ summary: 'Numbering patterns for students, invoices, receipts…' })
  @ApiZodResponse(200, numberSeriesListResponseSchema)
  async list(): Promise<NumberSeriesListResponse> {
    return { items: await this.numbering.list() };
  }

  @Put(':key')
  @RequirePermission('settings.manage')
  @ApiZodBody(setNumberSeriesRequestSchema)
  @ApiZodResponse(200, numberSeriesListResponseSchema)
  async set(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(setNumberSeriesRequestSchema)) body: SetNumberSeriesRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<NumberSeriesListResponse> {
    return { items: await this.numbering.setPattern(key, body.pattern, actorOf(auth)) };
  }
}
