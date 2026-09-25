import {
  type Branch,
  type BranchListResponse,
  branchListResponseSchema,
  branchSchema,
  type CreateBranchRequest,
  createBranchRequestSchema,
  type CreateDepartmentRequest,
  createDepartmentRequestSchema,
  type Department,
  type DepartmentListResponse,
  departmentListResponseSchema,
  departmentSchema,
  type UpdateBranchRequest,
  updateBranchRequestSchema,
  type UpdateDepartmentRequest,
  updateDepartmentRequestSchema,
} from '@emis/contracts';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../../common/authz/decorators.js';
import { Idempotent } from '../../../common/idempotency/idempotent.decorator.js';
import { ApiIfMatch, IfMatchVersion } from '../../../common/http/versioning.js';
import { ApiZodBody, ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { type AuthContext, CurrentAuth } from '../../identity/index.js';
import { OrganizationService } from '../application/organization.service.js';
import { actorOf } from './actor.js';

const uuid = new ParseUUIDPipe({ version: '7' });

@ApiTags('settings')
@Controller('branches')
export class BranchesController {
  constructor(private readonly org: OrganizationService) {}

  @Get()
  @RequirePermission('settings.read')
  @ApiOperation({ summary: 'All branches (campuses), active and inactive' })
  @ApiZodResponse(200, branchListResponseSchema)
  async list(): Promise<BranchListResponse> {
    return { items: await this.org.listBranches() };
  }

  @Post()
  @RequirePermission('settings.manage')
  @Idempotent({ required: false })
  @ApiZodBody(createBranchRequestSchema)
  @ApiZodResponse(201, branchSchema)
  create(
    @Body(new ZodValidationPipe(createBranchRequestSchema)) body: CreateBranchRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Branch> {
    return this.org.createBranch(createBranchRequestSchema.parse(body), actorOf(auth));
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Rename or (de)activate a branch. The code is fixed.' })
  @ApiIfMatch()
  @ApiZodBody(updateBranchRequestSchema)
  @ApiZodResponse(200, branchSchema)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateBranchRequestSchema)) body: UpdateBranchRequest,
    @IfMatchVersion() version: number,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Branch> {
    return this.org.updateBranch(id, updateBranchRequestSchema.parse(body), version, actorOf(auth));
  }
}

@ApiTags('settings')
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly org: OrganizationService) {}

  @Get()
  @RequirePermission('settings.read')
  @ApiOperation({ summary: 'All departments, active and inactive, in display order' })
  @ApiZodResponse(200, departmentListResponseSchema)
  async list(): Promise<DepartmentListResponse> {
    return { items: await this.org.listDepartments() };
  }

  @Post()
  @RequirePermission('settings.manage')
  @Idempotent({ required: false })
  @ApiZodBody(createDepartmentRequestSchema)
  @ApiZodResponse(201, departmentSchema)
  create(
    @Body(new ZodValidationPipe(createDepartmentRequestSchema)) body: CreateDepartmentRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Department> {
    return this.org.createDepartment(createDepartmentRequestSchema.parse(body), actorOf(auth));
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Rename, reorder or (de)activate a department. The code is fixed.' })
  @ApiIfMatch()
  @ApiZodBody(updateDepartmentRequestSchema)
  @ApiZodResponse(200, departmentSchema)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateDepartmentRequestSchema)) body: UpdateDepartmentRequest,
    @IfMatchVersion() version: number,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Department> {
    return this.org.updateDepartment(
      id,
      updateDepartmentRequestSchema.parse(body),
      version,
      actorOf(auth),
    );
  }
}
