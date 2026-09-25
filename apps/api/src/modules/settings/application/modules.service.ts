import {
  isModuleKey,
  MODULE_KEYS,
  MODULES,
  type ModuleKey,
  type ModuleState,
} from '@emis/contracts';
import { moduleSettings } from '@emis/db';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService } from '../../audit/index.js';
import { settingsErrors } from '../domain/errors.js';

@Injectable()
export class ModulesService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly audit: AuditService,
  ) {}

  /** Every module with its switch. Modules without a stored row are on. */
  async states(): Promise<ModuleState[]> {
    const rows = await this.txHost.tx.select().from(moduleSettings);
    const stored = new Map(rows.map((r) => [r.key, r.enabled]));
    return MODULE_KEYS.map((key) => ({
      key,
      name: MODULES[key].name,
      description: MODULES[key].description,
      requires: [...MODULES[key].requires],
      enabled: stored.get(key) ?? true,
    }));
  }

  async isEnabled(key: ModuleKey): Promise<boolean> {
    const [row] = await this.txHost.tx
      .select({ enabled: moduleSettings.enabled })
      .from(moduleSettings)
      .where(eq(moduleSettings.key, key));
    return row?.enabled ?? true;
  }

  /**
   * Switch a module on or off. A module can't be on while something it needs is off, so turning
   * on `pre_registration` needs `website`, and turning off `website` needs `pre_registration` off.
   */
  @Transactional()
  async set(key: string, enabled: boolean, actor: Actor): Promise<ModuleState[]> {
    if (!isModuleKey(key)) throw settingsErrors.unknownModule();
    // One writer at a time, so two admins can't each flip one side of a dependency.
    await this.txHost.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('emis.modules'))`);
    const current = new Map((await this.states()).map((m) => [m.key, m]));

    if (enabled) {
      const missing = MODULES[key].requires.filter((dep: ModuleKey) => !current.get(dep)?.enabled);
      if (missing.length > 0) {
        throw settingsErrors.moduleDependency(
          `Turn on ${missing.map((dep) => MODULES[dep].name).join(', ')} first.`,
        );
      }
    } else {
      const dependents = MODULE_KEYS.filter(
        (other) =>
          current.get(other)?.enabled &&
          (MODULES[other].requires as readonly string[]).includes(key),
      );
      if (dependents.length > 0) {
        throw settingsErrors.moduleDependency(
          `Turn off ${dependents.map((dep) => MODULES[dep].name).join(', ')} first.`,
        );
      }
    }

    const was = current.get(key)?.enabled ?? true;
    if (was !== enabled) {
      await this.txHost.tx
        .insert(moduleSettings)
        .values({ key, enabled, updatedBy: actor.userId })
        .onConflictDoUpdate({
          target: moduleSettings.key,
          set: { enabled, updatedBy: actor.userId, updatedAt: new Date() },
        });
      await this.audit.record({
        action: enabled ? 'module.enabled' : 'module.disabled',
        entityType: 'module',
        entityId: key,
      });
    }
    return this.states();
  }
}
