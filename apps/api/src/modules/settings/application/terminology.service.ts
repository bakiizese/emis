import {
  defaultTerminology,
  type SetTerminologyRequest,
  TERM_KEYS,
  TERMS,
  type Terminology,
  type TerminologyResponse,
} from '@emis/contracts';
import { terminologyOverrides } from '@emis/db';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';

import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService } from '../../audit/index.js';

@Injectable()
export class TerminologyService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly audit: AuditService,
  ) {}

  /** Every term with the institution's wording (defaults where nothing is overridden). */
  async current(): Promise<Terminology> {
    const terms = defaultTerminology();
    for (const row of await this.txHost.tx.select().from(terminologyOverrides)) {
      if (Object.hasOwn(terms, row.key)) {
        terms[row.key as keyof Terminology] = { singular: row.singular, plural: row.plural };
      }
    }
    return terms;
  }

  async list(): Promise<TerminologyResponse> {
    const terms = await this.current();
    return {
      items: TERM_KEYS.map((key) => ({
        key,
        ...terms[key],
        defaultSingular: TERMS[key][0],
        defaultPlural: TERMS[key][1],
      })),
    };
  }

  /** Replace all overrides. Terms left out, or set back to their default wording, are reset. */
  @Transactional()
  async set(input: SetTerminologyRequest, actor: Actor): Promise<TerminologyResponse> {
    const before = await this.current();
    const rows = TERM_KEYS.flatMap((key) => {
      const override = input.overrides[key];
      if (!override) return [];
      if (override.singular === TERMS[key][0] && override.plural === TERMS[key][1]) return [];
      return [{ key, ...override, updatedBy: actor.userId }];
    });

    await this.txHost.tx.delete(terminologyOverrides);
    if (rows.length > 0) await this.txHost.tx.insert(terminologyOverrides).values(rows);

    const after = await this.current();
    const changes = Object.fromEntries(
      TERM_KEYS.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(
        (key) => [key, { from: before[key], to: after[key] }],
      ),
    );
    if (Object.keys(changes).length > 0) {
      await this.audit.record({
        action: 'terminology.updated',
        entityType: 'terminology',
        changes,
      });
    }
    return this.list();
  }
}
