import { Module } from '@nestjs/common';

import { AccessModule } from '../access/index.js';
import { AdmissionsModule } from '../admissions/index.js';
import { AuditModule } from '../audit/index.js';
import { CatalogModule } from '../catalog/index.js';
import { SettingsModule } from '../settings/index.js';
import { StudentsModule } from '../students/index.js';
import { CohortsService } from './application/cohorts.service.js';
import { EnrollmentsService } from './application/enrollments.service.js';
import { CohortsController, EnrollmentsController } from './interface/cohorts.controller.js';

/** Scheduled classes, and the students in them: seats, waitlists, withdrawals, results. */
@Module({
  imports: [
    AuditModule,
    SettingsModule,
    CatalogModule,
    StudentsModule,
    AdmissionsModule,
    AccessModule,
  ],
  controllers: [CohortsController, EnrollmentsController],
  providers: [CohortsService, EnrollmentsService],
  exports: [CohortsService, EnrollmentsService],
})
export class CohortsModule {}
