import { formatMoney } from '@emis/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.js';
import { InstitutionService } from '../../settings/index.js';
import type { Letterhead } from '../domain/templates.js';

/** What every document needs from the institution: its letterhead, its clock, and its verify link. */
@Injectable()
export class DocumentContext {
  constructor(
    private readonly institution: InstitutionService,
    @Inject(APP_CONFIG) private readonly env: Env,
  ) {}

  async letterhead(): Promise<Letterhead> {
    const row = await this.institution.get();
    return {
      name: row.name,
      address: [row.address, row.city].filter(Boolean).join(', ') || null,
      phone: row.phone,
      color: row.primaryColor,
    };
  }

  /** "12 Sep 2026" for a date ("YYYY-MM-DD") or an instant, on the institution's calendar. */
  async date(value: string | Date): Promise<string> {
    const { timezone } = await this.institution.get();
    const at = typeof value === 'string' ? new Date(`${value}T12:00:00Z`) : value;
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: typeof value === 'string' ? 'UTC' : timezone,
    }).format(at);
  }

  async dateTime(value: Date): Promise<string> {
    const { timezone } = await this.institution.get();
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    }).format(value);
  }

  money(minorUnits: number, currency: string): string {
    return formatMoney(minorUnits, currency);
  }

  /** The address printed under a QR code: the public website's verification page. */
  verifyUrl(token: string): string {
    return `${this.env.WEB_URL.replace(/\/$/, '')}/verify/${token}`;
  }
}
