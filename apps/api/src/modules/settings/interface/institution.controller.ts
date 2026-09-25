import {
  type Institution,
  institutionSchema,
  type PublicProfile,
  publicProfileSchema,
  type UpdateInstitutionRequest,
  updateInstitutionRequestSchema,
} from '@emis/contracts';
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../../common/authz/decorators.js';
import { ApiIfMatch, IfMatchVersion } from '../../../common/http/versioning.js';
import { ApiZodBody, ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { type AuthContext, CurrentAuth, Public } from '../../identity/index.js';
import { InstitutionService } from '../application/institution.service.js';
import { actorOf } from './actor.js';

@ApiTags('settings')
@Controller('institution')
export class InstitutionController {
  constructor(private readonly institution: InstitutionService) {}

  @Get('public')
  @Public()
  @ApiOperation({ summary: 'Name, branding, wording and switched-on modules, for anyone' })
  @ApiZodResponse(200, publicProfileSchema)
  publicProfile(): Promise<PublicProfile> {
    return this.institution.publicProfile();
  }

  @Get()
  @RequirePermission('settings.read')
  @ApiZodResponse(200, institutionSchema)
  get(): Promise<Institution> {
    return this.institution.get();
  }

  @Patch()
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Update the institution profile, branding and regional settings' })
  @ApiIfMatch()
  @ApiZodBody(updateInstitutionRequestSchema)
  @ApiZodResponse(200, institutionSchema)
  update(
    @Body(new ZodValidationPipe(updateInstitutionRequestSchema)) body: UpdateInstitutionRequest,
    @IfMatchVersion() version: number,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Institution> {
    return this.institution.update(
      updateInstitutionRequestSchema.parse(body),
      version,
      actorOf(auth),
    );
  }
}
