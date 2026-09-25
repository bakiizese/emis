import type { Institution, PublicProfile, UpdateInstitutionRequest } from '@emis/contracts';
import { institution, updateWithVersion } from '@emis/db';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable, InternalServerErrorException } from '@nestjs/common';

import { versionedRow } from '../../../common/http/versioning.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService, diffChanges } from '../../audit/index.js';
import { calendarParts } from '../domain/calendar.js';
import { ModulesService } from './modules.service.js';
import { TerminologyService } from './terminology.service.js';

type InstitutionRow = typeof institution.$inferSelect;

export function toInstitution(row: InstitutionRow): Institution {
  return {
    name: row.name,
    shortName: row.shortName,
    tagline: row.tagline,
    email: row.email,
    phone: row.phone,
    website: row.website,
    address: row.address,
    city: row.city,
    country: row.country,
    primaryColor: row.primaryColor,
    locale: row.locale,
    currency: row.currency,
    timezone: row.timezone,
    calendarDisplay: row.calendarDisplay,
    fiscalYearStart: row.fiscalYearStart,
    setupCompleted: row.setupCompletedAt !== null,
    version: row.version,
  };
}

@Injectable()
export class InstitutionService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly modules: ModulesService,
    private readonly terminology: TerminologyService,
    private readonly audit: AuditService,
  ) {}

  /** The one institution row (created by the migration, so it always exists). */
  async row(options: { forUpdate?: boolean } = {}): Promise<InstitutionRow> {
    const query = this.txHost.tx.select().from(institution).limit(1);
    const [row] = options.forUpdate ? await query.for('update') : await query;
    if (!row) throw new InternalServerErrorException('Institution row is missing');
    return row;
  }

  /** Today's date ("YYYY-MM-DD") on the institution's own clock, which is what "overdue" is judged by. */
  async today(): Promise<string> {
    const { timezone } = await this.row();
    const { year, month, day } = calendarParts(new Date(), timezone);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  async get(): Promise<Institution> {
    return toInstitution(await this.row());
  }

  @Transactional()
  async update(
    input: UpdateInstitutionRequest,
    expectedVersion: number,
    actor: Actor,
  ): Promise<Institution> {
    const before = await this.row();
    const row = versionedRow(
      await updateWithVersion(this.txHost.tx, institution, before.id, expectedVersion, {
        ...input,
        updatedBy: actor.userId,
      }),
      () => new InternalServerErrorException('Institution row is missing'),
    );
    await this.audit.record({
      action: 'institution.updated',
      entityType: 'institution',
      entityId: row.id,
      changes: diffChanges(before, input),
    });
    return toInstitution(row);
  }

  async publicProfile(): Promise<PublicProfile> {
    const row = await this.row();
    const terminology = await this.terminology.current();
    const modules = await this.modules.states();
    return {
      name: row.name,
      shortName: row.shortName,
      tagline: row.tagline,
      primaryColor: row.primaryColor,
      locale: row.locale,
      currency: row.currency,
      timezone: row.timezone,
      calendarDisplay: row.calendarDisplay,
      setupCompleted: row.setupCompletedAt !== null,
      terminology,
      modules: Object.fromEntries(
        modules.map((m) => [m.key, m.enabled]),
      ) as PublicProfile['modules'],
    };
  }
}
