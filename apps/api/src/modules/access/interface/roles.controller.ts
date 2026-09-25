import { type RoleListResponse, roleListResponseSchema } from '@emis/contracts';
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../../common/authz/decorators.js';
import { ApiZodResponse } from '../../../common/zod/openapi.js';
import { RolesService } from '../application/roles.service.js';

@ApiTags('staff')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission('users.read')
  @ApiOperation({ summary: 'Roles with their permissions and where they can be granted' })
  @ApiZodResponse(200, roleListResponseSchema)
  async list(): Promise<RoleListResponse> {
    return { items: await this.roles.list() };
  }
}
