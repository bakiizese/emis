import { type Dashboard, dashboardSchema } from '@emis/contracts';
import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { SelfService } from '../../../common/authz/decorators.js';
import { ApiZodResponse } from '../../../common/zod/openapi.js';
import { type AuthContext, CurrentAuth } from '../../identity/index.js';
import { DashboardService } from '../application/dashboard.service.js';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @SelfService()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'The portal home: headline numbers for the areas the caller may see, limited to their branches',
  })
  @ApiZodResponse(200, dashboardSchema)
  get(@CurrentAuth() auth: AuthContext): Promise<Dashboard> {
    return this.dashboard.forUser(auth.userId);
  }
}
