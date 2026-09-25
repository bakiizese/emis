import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/index.js';
import { IdentityModule } from '../identity/index.js';
import { SettingsModule } from '../settings/index.js';
import { AccessService } from './application/access.service.js';
import { AdminBootstrapService } from './application/admin-bootstrap.service.js';
import { InvitationsService } from './application/invitations.service.js';
import { RolesService } from './application/roles.service.js';
import { UsersService } from './application/users.service.js';
import { ScopeResolver } from './domain/scope-resolver.js';
import { OrgScopeResolver } from './infrastructure/org-scope-resolver.js';
import { AccessController } from './interface/access.controller.js';
import { InvitationsController } from './interface/invitations.controller.js';
import { PermissionGuard } from './interface/permission.guard.js';
import { RolesController } from './interface/roles.controller.js';
import { UsersController } from './interface/users.controller.js';

@Module({
  imports: [IdentityModule, AuditModule, SettingsModule],
  controllers: [UsersController, RolesController, InvitationsController, AccessController],
  providers: [
    AccessService,
    AdminBootstrapService,
    RolesService,
    UsersService,
    InvitationsService,
    PermissionGuard,
    { provide: ScopeResolver, useClass: OrgScopeResolver },
  ],
  exports: [AccessService, AdminBootstrapService, PermissionGuard],
})
export class AccessModule {}
