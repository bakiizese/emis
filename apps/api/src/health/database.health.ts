import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type pg from 'pg';

import { PG_POOL } from '../database/database.module.js';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly health: HealthIndicatorService,
  ) {}

  async check(key: string) {
    const indicator = this.health.check(key);
    try {
      await this.pool.query('SELECT 1');
      return indicator.up();
    } catch {
      return indicator.down({ message: 'unreachable' });
    }
  }
}
