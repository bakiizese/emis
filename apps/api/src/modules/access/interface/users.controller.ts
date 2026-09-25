import {
  type AssignRoleRequest,
  assignRoleRequestSchema,
  type InviteStaffRequest,
  inviteStaffRequestSchema,
  type SetStaffStatusRequest,
  setStaffStatusRequestSchema,
  type StaffListQuery,
  staffListQuerySchema,
  type StaffListResponse,
  staffListResponseSchema,
  type StaffUser,
  staffUserSchema,
} from '@emis/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../../common/authz/decorators.js';
import { Idempotent } from '../../../common/idempotency/idempotent.decorator.js';
import { ApiZodBody, ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { type AuthContext, CurrentAuth } from '../../identity/index.js';
import { UsersService } from '../application/users.service.js';

const uuid = new ParseUUIDPipe({ version: '7' });
const actorOf = (auth: AuthContext) => ({
  userId: auth.userId,
  email: auth.email,
  sessionId: auth.sessionId,
  displayName: auth.displayName,
});

@ApiTags('staff')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('users.read')
  @ApiOperation({ summary: 'Staff accounts, newest first (search with ?q=)' })
  @ApiZodResponse(200, staffListResponseSchema)
  list(
    @Query(new ZodValidationPipe(staffListQuerySchema)) query: StaffListQuery,
  ): Promise<StaffListResponse> {
    return this.users.list(query);
  }

  @Get(':id')
  @RequirePermission('users.read')
  @ApiZodResponse(200, staffUserSchema)
  get(@Param('id', uuid) id: string): Promise<StaffUser> {
    return this.users.get(id);
  }

  @Post('invitations')
  @RequirePermission('users.invite')
  @Idempotent()
  @ApiOperation({
    summary: 'Invite a staff member: creates the account, grants the role, emails a link',
  })
  @ApiZodBody(inviteStaffRequestSchema)
  @ApiZodResponse(201, staffUserSchema)
  invite(
    @Body(new ZodValidationPipe(inviteStaffRequestSchema)) body: InviteStaffRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<StaffUser> {
    const input = inviteStaffRequestSchema.parse(body);
    return this.users.invite(input, actorOf(auth));
  }

  @Post(':id/invitation')
  @RequirePermission('users.manage')
  @Idempotent({ required: false })
  @HttpCode(202)
  @ApiOperation({ summary: 'Send a fresh invitation link (the old one stops working)' })
  async resend(@Param('id', uuid) id: string, @CurrentAuth() auth: AuthContext): Promise<void> {
    await this.users.resendInvitation(id, actorOf(auth));
  }

  @Patch(':id/status')
  @RequirePermission('users.manage')
  @ApiOperation({ summary: 'Disable (signs them out everywhere) or re-enable an account' })
  @ApiZodBody(setStaffStatusRequestSchema)
  @ApiZodResponse(200, staffUserSchema)
  setStatus(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(setStaffStatusRequestSchema)) body: SetStaffStatusRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<StaffUser> {
    return this.users.setStatus(id, body.status, actorOf(auth));
  }

  @Post(':id/roles')
  @RequirePermission('roles.assign')
  @ApiOperation({ summary: 'Grant a role at a scope' })
  @ApiZodBody(assignRoleRequestSchema)
  @ApiZodResponse(201, staffUserSchema)
  assignRole(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(assignRoleRequestSchema)) body: AssignRoleRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<StaffUser> {
    return this.users.assignRole(id, assignRoleRequestSchema.parse(body), actorOf(auth));
  }

  @Delete(':id/roles/:assignmentId')
  @RequirePermission('roles.assign')
  @ApiOperation({ summary: 'Remove a role (the last active admin is protected)' })
  @ApiZodResponse(200, staffUserSchema)
  removeRole(
    @Param('id', uuid) id: string,
    @Param('assignmentId', uuid) assignmentId: string,
  ): Promise<StaffUser> {
    return this.users.removeAssignment(id, assignmentId);
  }
}
