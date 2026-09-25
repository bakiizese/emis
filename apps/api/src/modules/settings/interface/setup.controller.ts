import {
  type CompleteSetupRequest,
  completeSetupRequestSchema,
  type Institution,
  institutionSchema,
  type SetupStatusResponse,
  setupStatusResponseSchema,
} from '@emis/contracts';
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../../common/authz/decorators.js';
import { Idempotent } from '../../../common/idempotency/idempotent.decorator.js';
import { ApiZodBody, ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { type AuthContext, CurrentAuth } from '../../identity/index.js';
import { SetupService } from '../application/setup.service.js';
import { actorOf } from './actor.js';

@ApiTags('settings')
@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get()
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Whether first-run setup is done, and the presets to start from' })
  @ApiZodResponse(200, setupStatusResponseSchema)
  status(): Promise<SetupStatusResponse> {
    return this.setup.status();
  }

  @Post()
  @RequirePermission('settings.manage')
  @Idempotent()
  @HttpCode(200)
  @ApiOperation({ summary: 'Finish first-run setup: profile, branches, departments, lists' })
  @ApiZodBody(completeSetupRequestSchema)
  @ApiZodResponse(200, institutionSchema)
  complete(
    @Body(new ZodValidationPipe(completeSetupRequestSchema)) body: CompleteSetupRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Institution> {
    return this.setup.complete(completeSetupRequestSchema.parse(body), actorOf(auth));
  }
}
