import {
  type DisableTotpRequest,
  disableTotpRequestSchema,
  type MfaVerifyRequest,
  mfaVerifyRequestSchema,
  type RecoveryCodesResponse,
  recoveryCodesResponseSchema,
  type TotpConfirmRequest,
  totpConfirmRequestSchema,
  type TotpSetupResponse,
  totpSetupResponseSchema,
} from '@emis/contracts';
import { Body, Controller, Delete, HttpCode, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';

import { ApiZodBody, ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { MfaService } from '../application/mfa.service.js';
import type { AuthContext, RequestContext } from '../domain/types.js';
import { AllowMfaPending, CurrentAuth, ReqContext } from './decorators.js';
import { SessionCookie } from './session-cookie.js';

const PER_MINUTE = 60_000;

@ApiTags('auth')
@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly cookie: SessionCookie,
  ) {}

  @Post('totp/setup')
  @AllowMfaPending()
  @HttpCode(200)
  @ApiOperation({ summary: 'Start authenticator-app enrollment (QR code + secret)' })
  @ApiZodResponse(200, totpSetupResponseSchema)
  setup(@CurrentAuth() auth: AuthContext): Promise<TotpSetupResponse> {
    return this.mfa.setup(auth);
  }

  @Post('totp/confirm')
  @AllowMfaPending()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: PER_MINUTE } })
  @ApiOperation({ summary: 'Finish enrollment with a code; returns one-time recovery codes' })
  @ApiZodBody(totpConfirmRequestSchema)
  @ApiZodResponse(200, recoveryCodesResponseSchema)
  async confirm(
    @Body(new ZodValidationPipe(totpConfirmRequestSchema)) body: TotpConfirmRequest,
    @CurrentAuth() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<RecoveryCodesResponse> {
    const { token, response } = await this.mfa.confirm(auth, body.code, context);
    this.cookie.set(reply, token);
    return response;
  }

  @Post('verify')
  @AllowMfaPending()
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: PER_MINUTE } })
  @ApiOperation({ summary: 'Second sign-in step: authenticator code or recovery code' })
  @ApiZodBody(mfaVerifyRequestSchema)
  async verify(
    @Body(new ZodValidationPipe(mfaVerifyRequestSchema)) body: MfaVerifyRequest,
    @CurrentAuth() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const { token } = await this.mfa.verify(auth, body, context);
    this.cookie.set(reply, token);
  }

  @Delete('totp')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: PER_MINUTE } })
  @ApiOperation({ summary: 'Turn off two-factor authentication (not allowed when enforced)' })
  @ApiZodBody(disableTotpRequestSchema)
  async disable(
    @Body(new ZodValidationPipe(disableTotpRequestSchema)) body: DisableTotpRequest,
    @CurrentAuth() auth: AuthContext,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.mfa.disable(auth, body, context);
  }
}
