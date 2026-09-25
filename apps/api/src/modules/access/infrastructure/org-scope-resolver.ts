import type { Scope } from '@emis/permissions';
import { Injectable } from '@nestjs/common';

import { OrganizationService } from '../../settings/index.js';
import { ScopeResolver } from '../domain/scope-resolver.js';

/** Branch and department scopes must point at an active branch or department. */
@Injectable()
export class OrgScopeResolver extends ScopeResolver {
  constructor(private readonly org: OrganizationService) {
    super();
  }

  exists(scope: Scope): Promise<boolean> {
    if (scope.type === 'global') return Promise.resolve(true);
    return this.org.isActiveUnit(scope.type, scope.id);
  }
}
