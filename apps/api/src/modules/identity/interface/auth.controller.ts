import {
  type ChangePasswordRequest,
  changePasswordRequestSchema,
  type ForgotPasswordRequest,
  forgotPasswordRequestSchema,
  type LoginRequest,
  loginRequestSchema,
  type LoginResponse,
  loginResponseSchema,
  type MeResponse,
  meResponseSchema,
  type ResetPasswordRequest,
  resetPasswordRequestSchema,
} from '@emis/contracts';
import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';

import { SelfService } from '../../../common/authz/decorators.js';
import { ApiZodBody, ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { AuthService } from '../application/auth.service.js';
import { PasswordService } from '../application/password.service.js';
import type { AuthContext, RequestContext } from '../domain/types.js';
import { AllowMfaPending, CurrentAuth, Public, ReqContext } from './decorators.js';
import { SessionCookie } from './session-cookie.js';

const PER_MINUTE = 60_000;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwords: PasswordService,
    private readonly cookie: SessionCookie,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: PER_MINUTE } })
  @ApiOperation({ summary: 'Sign in with email and password; sets the session cookie' })
  @ApiZodBody(loginRequestSchema)
  @ApiZodResponse(200, loginResponseSchema)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponse> {
    const { token, response } = await this.auth.login(body, context);
    this.cookie.set(reply, token);
    return response;
  }

  @Post('logout')
  @SelfService()
  @AllowMfaPending()
  @HttpCode(204)
  @ApiOperation({ summary: 'End the current session' })
  async logout(
    @CurrentAuth() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(auth, context);
    this.cookie.clear(reply);
  }

  @Get('me')
  @SelfService()
  @AllowMfaPending()
  @ApiOperation({ summary: 'The signed-in user, session and what to do next' })
  @ApiZodResponse(200, meResponseSchema)
  me(@CurrentAuth() auth: AuthContext): MeResponse {
    return this.auth.me(auth);
  }

  @Post('password/forgot')
  @Public()
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: PER_MINUTE } })
  @ApiOperation({ summary: 'Email a reset link (always 202, whether or not the account exists)' })
  @ApiZodBody(forgotPasswordRequestSchema)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordRequestSchema)) body: ForgotPasswordRequest,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.passwords.requestReset(body.email, context);
  }

  @Post('password/reset')
  @Public()
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: PER_MINUTE } })
  @ApiOperation({ summary: 'Set a new password with a reset token; signs out everywhere' })
  @ApiZodBody(resetPasswordRequestSchema)
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordRequestSchema)) body: ResetPasswordRequest,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.passwords.resetPassword(body.token, body.password, context);
  }

  @Post('password/change')
  @SelfService()
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: PER_MINUTE } })
  @ApiOperation({ summary: 'Change password; other sessions are signed out' })
  @ApiZodBody(changePasswordRequestSchema)
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordRequestSchema)) body: ChangePasswordRequest,
    @CurrentAuth() auth: AuthContext,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const token = await this.passwords.changePassword(auth, body, context);
    this.cookie.set(reply, token);
  }
}
