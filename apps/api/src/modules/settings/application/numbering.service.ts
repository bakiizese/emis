import {
  formatNumber,
  isNumberSeriesKey,
  NUMBER_SERIES,
  NUMBER_SERIES_KEYS,
  type NumberSeries,
  type NumberSeriesKey,
  numberScope,
  patternUsesBranch,
} from '@emis/contracts';
import { branches, numberCounters, numberSeries } from '@emis/db';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';

import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService } from '../../audit/index.js';
import { numberContextAt } from '../domain/calendar.js';
import { settingsErrors } from '../domain/errors.js';
import { InstitutionService } from './institution.service.js';

export interface IssuedNumber {
  number: string;
  sequence: number;
}

@Injectable()
export class NumberingService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly institution: InstitutionService,
    private readonly audit: AuditService,
  ) {}

  private async patterns(): Promise<Record<NumberSeriesKey, string>> {
    const stored = new Map(
      (await this.txHost.tx.select().from(numberSeries)).map((r) => [r.key, r.pattern]),
    );
    return Object.fromEntries(
      NUMBER_SERIES_KEYS.map((key) => [key, stored.get(key) ?? NUMBER_SERIES[key].defaultPattern]),
    ) as Record<NumberSeriesKey, string>;
  }

  async list(): Promise<NumberSeries[]> {
    const patterns = await this.patterns();
    const inst = await this.institution.row();
    const [firstBranch] = await this.txHost.tx
      .select({ code: branches.code })
      .from(branches)
      .where(eq(branches.isActive, true))
      .orderBy(asc(branches.name))
      .limit(1);
    const ctx = numberContextAt(new Date(), inst, firstBranch?.code ?? 'MAIN');
    return NUMBER_SERIES_KEYS.map((key) => ({
      key,
      name: NUMBER_SERIES[key].name,
      pattern: patterns[key],
      defaultPattern: NUMBER_SERIES[key].defaultPattern,
      example: formatNumber(patterns[key], ctx, 1),
    }));
  }

  @Transactional()
  async setPattern(key: string, pattern: string, actor: Actor): Promise<NumberSeries[]> {
    if (!isNumberSeriesKey(key)) throw settingsErrors.unknownSeries();
    const before = (await this.patterns())[key];
    if (before !== pattern) {
      await this.txHost.tx
        .insert(numberSeries)
        .values({ key, pattern, updatedBy: actor.userId })
        .onConflictDoUpdate({
          target: numberSeries.key,
          set: { pattern, updatedBy: actor.userId, updatedAt: new Date() },
        });
      await this.audit.record({
        action: 'number_series.updated',
        entityType: 'number_series',
        entityId: key,
        changes: { pattern: { from: before, to: pattern } },
      });
    }
    return this.list();
  }

  /**
   * Issue the next number in a series. Call it inside the transaction that stores the numbered
   * record: the counter row stays locked until that transaction ends, so concurrent issuers queue
   * up, and a rollback hands the number back. Numbers are therefore gapless and never repeat.
   */
  @Transactional()
  async next(
    key: NumberSeriesKey,
    options: { branchId?: string; at?: Date } = {},
  ): Promise<IssuedNumber> {
    // Sequential, not Promise.all: these share the caller's transaction connection.
    const pattern = (await this.patterns())[key];
    const inst = await this.institution.row();

    let branchCode: string | undefined;
    if (patternUsesBranch(pattern)) {
      if (!options.branchId) throw new Error(`Number series "${key}" needs a branch`);
      const [branch] = await this.txHost.tx
        .select({ code: branches.code })
        .from(branches)
        .where(eq(branches.id, options.branchId));
      if (!branch) throw settingsErrors.branchNotFound();
      branchCode = branch.code;
    }

    const ctx = numberContextAt(options.at ?? new Date(), inst, branchCode);
    const scope = numberScope(pattern, ctx);
    const [row] = await this.txHost.tx
      .insert(numberCounters)
      .values({ seriesKey: key, scope, lastValue: 1 })
      .onConflictDoUpdate({
        target: [numberCounters.seriesKey, numberCounters.scope],
        set: { lastValue: sql`${numberCounters.lastValue} + 1`, updatedAt: new Date() },
      })
      .returning({ lastValue: numberCounters.lastValue });
    if (!row) throw new Error('Counter upsert returned nothing');

    return { number: formatNumber(pattern, ctx, row.lastValue), sequence: row.lastValue };
  }
}
