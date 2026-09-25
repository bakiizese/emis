import { type MyAccessResponse, myAccessResponseSchema } from '@emis/contracts';
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { SelfService } from '../../../common/authz/decorators.js';
import { ApiZodResponse } from '../../../common/zod/openapi.js';
import { type AuthContext, CurrentAuth } from '../../identity/index.js';
import { AccessService } from '../application/access.service.js';

@ApiTags('staff')
@Controller('access')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('me')
  @SelfService()
  @ApiOperation({
    summary: 'Your roles and permissions (the portal uses this to show the right screens)',
  })
  @ApiZodResponse(200, myAccessResponseSchema)
  me(@CurrentAuth() auth: AuthContext): Promise<MyAccessResponse> {
    return this.access.myAccess(auth.userId);
  }
}
