import { type SessionListResponse, sessionListResponseSchema } from '@emis/contracts';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { SelfService } from '../../../common/authz/decorators.js';

import { ApiZodResponse } from '../../../common/zod/openapi.js';
import { SecurityEventsService } from '../application/security-events.service.js';
import { SessionsService } from '../application/sessions.service.js';
import type { AuthContext, RequestContext } from '../domain/types.js';
import { CurrentAuth, ReqContext } from './decorators.js';

@ApiTags('auth')
@SelfService()
@Controller('auth/sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly events: SecurityEventsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Your active sessions (devices)' })
  @ApiZodResponse(200, sessionListResponseSchema)
  async list(@CurrentAuth() auth: AuthContext): Promise<SessionListResponse> {
    const sessions = await this.sessions.listActive(auth.userId);
    return {
      items: sessions.map((s) => ({
        id: s.id,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        current: s.id === auth.sessionId,
      })),
    };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Sign out one of your sessions' })
  async revoke(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentAuth() auth: AuthContext,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    // Scoped to the caller: someone else's session id is simply "not found".
    if (!(await this.sessions.revokeOwn(auth.userId, id, 'revoked_by_user'))) {
      throw new NotFoundException({ code: 'SESSION_NOT_FOUND', message: 'Session not found.' });
    }
    await this.events.record('session.revoked', context, {
      userId: auth.userId,
      metadata: { sessionId: id },
    });
  }
}
