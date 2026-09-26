import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/index.js';
import { SettingsModule } from '../settings/index.js';
import { ReportsService } from './application/reports.service.js';
import { ReportsController } from './interface/reports.controller.js';

/** Finance reports: revenue, and outstanding balances by age. */
@Module({
  imports: [AuditModule, SettingsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
