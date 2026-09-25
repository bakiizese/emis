import type { ModuleKey } from '@emis/contracts';
import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ModulesService } from '../application/modules.service.js';
import { settingsErrors } from '../domain/errors.js';

export const REQUIRED_MODULE = 'settings:required-module';

/** The route belongs to a module that can be switched off; it answers 404 while it's off. */
export const RequiresModule = (key: ModuleKey) => SetMetadata(REQUIRED_MODULE, key);

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly modules: ModulesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<ModuleKey | undefined>(REQUIRED_MODULE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (key && !(await this.modules.isEnabled(key))) throw settingsErrors.moduleDisabled();
    return true;
  }
}
