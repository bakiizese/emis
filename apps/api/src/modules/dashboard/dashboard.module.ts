import { Module } from '@nestjs/common';

import { AccessModule } from '../access/index.js';
import { CohortsModule } from '../cohorts/index.js';
import { ReportsModule } from '../reports/index.js';
import { SettingsModule } from '../settings/index.js';
import { DashboardService } from './application/dashboard.service.js';
import { DashboardController } from './interface/dashboard.controller.js';

/** The numbers on the portal home page. */
@Module({
  imports: [AccessModule, SettingsModule, CohortsModule, ReportsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
