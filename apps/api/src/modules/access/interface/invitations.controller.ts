import {
  type AcceptInvitationRequest,
  acceptInvitationRequestSchema,
  type InvitationDetails,
  invitationDetailsSchema,
  invitationTokenSchema,
} from '@emis/contracts';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ApiZodBody, ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { Public } from '../../identity/index.js';
import { InvitationsService } from '../application/invitations.service.js';

const PER_MINUTE = 60_000;

/** Used by invited staff before they have a password, so these routes are public (and throttled). */
@ApiTags('staff')
@Public()
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post('inspect')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: PER_MINUTE } })
  @ApiOperation({
    summary: 'Who an invitation link is for (to greet them on the set-password page)',
  })
  @ApiZodBody(invitationTokenSchema)
  @ApiZodResponse(200, invitationDetailsSchema)
  inspect(
    @Body(new ZodValidationPipe(invitationTokenSchema)) body: { token: string },
  ): Promise<InvitationDetails> {
    return this.invitations.inspect(body.token);
  }

  @Post('accept')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: PER_MINUTE } })
  @ApiOperation({ summary: 'Set a password and activate the account' })
  @ApiZodBody(acceptInvitationRequestSchema)
  async accept(
    @Body(new ZodValidationPipe(acceptInvitationRequestSchema)) body: AcceptInvitationRequest,
  ): Promise<void> {
    await this.invitations.accept(body.token, body.password);
  }
}
