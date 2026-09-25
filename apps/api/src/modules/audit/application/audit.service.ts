import type {
  AuditEntry,
  AuditListQuery,
  AuditListResponse,
  AuditVerifyResponse,
} from '@emis/contracts';
import { auditLog, decodeCursor, encodeCursor } from '@emis/db';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, lt, type SQL, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { type AuditContent, chainHash } from '../domain/hash-chain.js';

export interface AuditRecord {
  /** Past-tense, dotted: `user.invited`, `role.assigned`, `payment.voided`. */
  action: string;
  entityType: string;
  entityId?: string | null;
  /** What changed. Never put secrets or full personal records here. */
  changes?: Record<string, unknown>;
  /** Override the actor (e.g. an invited person accepting, before they have a session). */
  actor?: { userId: string; email: string };
}

const VERIFY_BATCH = 1000;

type AuditRow = typeof auditLog.$inferSelect;

function contentOf(row: AuditRow): AuditContent {
  return {
    occurredAt: row.occurredAt.toISOString(),
    actorUserId: row.actorUserId,
    actorEmail: row.actorEmail,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    changes: row.changes,
    requestId: row.requestId,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  };
}

@Injectable()
export class AuditService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /**
   * Append an entry in the caller's transaction, so the change and its audit trail commit (or roll
   * back) together. A transaction-scoped advisory lock serializes writers so the chain never forks.
   */
  @Transactional()
  async record(entry: AuditRecord): Promise<void> {
    const tx = this.txHost.tx;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('emis.audit_log'))`);
    const [last] = await tx
      .select({ hash: auditLog.hash })
      .from(auditLog)
      .orderBy(desc(auditLog.seq))
      .limit(1);

    const request = this.cls.isActive() ? this.cls.get('request') : undefined;
    const actor = entry.actor ?? (this.cls.isActive() ? this.cls.get('actor') : undefined);
    const content: AuditContent = {
      occurredAt: new Date().toISOString(),
      actorUserId: actor?.userId ?? null,
      actorEmail: actor?.email ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      // Round-trip through JSON so what we hash is exactly what jsonb will give back.
      changes: JSON.parse(JSON.stringify(entry.changes ?? {})) as Record<string, unknown>,
      requestId: request?.requestId ?? null,
      ipAddress: request?.ip ?? null,
      userAgent: request?.userAgent ?? null,
    };
    const prevHash = last?.hash ?? null;

    await tx.insert(auditLog).values({
      ...content,
      occurredAt: new Date(content.occurredAt),
      prevHash,
      hash: chainHash(content, prevHash),
    });
  }

  async list(query: AuditListQuery): Promise<AuditListResponse> {
    const conditions: (SQL | undefined)[] = [
      query.action ? eq(auditLog.action, query.action) : undefined,
      query.entityType ? eq(auditLog.entityType, query.entityType) : undefined,
      query.entityId ? eq(auditLog.entityId, query.entityId) : undefined,
      query.actorUserId ? eq(auditLog.actorUserId, query.actorUserId) : undefined,
    ];
    if (query.cursor) {
      const [seq] = decodeCursor(query.cursor, 1);
      conditions.push(lt(auditLog.seq, Number(seq)));
    }

    const rows = await this.txHost.tx
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.seq))
      .limit(query.limit + 1);

    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items: items.map((row): AuditEntry => ({
        id: row.id,
        seq: row.seq,
        occurredAt: row.occurredAt.toISOString(),
        actorUserId: row.actorUserId,
        actorEmail: row.actorEmail,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        changes: row.changes,
        requestId: row.requestId,
        ipAddress: row.ipAddress,
      })),
      nextCursor: rows.length > query.limit && last ? encodeCursor([last.seq]) : null,
    };
  }

  /** Recompute the whole chain in order. Any edited, removed or re-ordered row shows up here. */
  async verify(): Promise<AuditVerifyResponse> {
    let prevHash: string | null = null;
    let checked = 0;
    let afterSeq = 0;

    for (;;) {
      const batch: AuditRow[] = await this.txHost.tx
        .select()
        .from(auditLog)
        .where(gt(auditLog.seq, afterSeq))
        .orderBy(asc(auditLog.seq))
        .limit(VERIFY_BATCH);
      if (batch.length === 0) break;

      for (const row of batch) {
        if (row.prevHash !== prevHash || chainHash(contentOf(row), row.prevHash) !== row.hash) {
          return { intact: false, checked, brokenAtSeq: row.seq };
        }
        prevHash = row.hash;
        checked += 1;
        afterSeq = row.seq;
      }
    }
    return { intact: true, checked, brokenAtSeq: null };
  }
}
