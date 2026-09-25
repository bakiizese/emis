import { healthStatusSchema, type HealthStatus } from '@emis/contracts';
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

import { ApiZodResponse } from '../common/zod/openapi.js';
import { API_VERSION } from '../version.js';
import { DatabaseHealthIndicator } from './database.health.js';

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
  ) {}

  /** Liveness: the process is up. Never touches dependencies, so it can't cascade failures. */
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiZodResponse(200, healthStatusSchema)
  getLiveness(): HealthStatus {
    return {
      status: 'ok',
      service: 'api',
      version: API_VERSION,
      uptimeSeconds: process.uptime(),
    };
  }

  /** Readiness: dependencies are reachable, so the instance can take traffic. 503 otherwise. */
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe (checks the database)' })
  getReadiness() {
    return this.health.check([() => this.database.check('database')]);
  }
}
