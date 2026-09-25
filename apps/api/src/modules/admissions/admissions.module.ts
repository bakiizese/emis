import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/index.js';
import { CatalogModule } from '../catalog/index.js';
import { SettingsModule } from '../settings/index.js';
import { StudentsModule } from '../students/index.js';
import { ApplicationsService } from './application/applications.service.js';
import { ApplicationsController } from './interface/applications.controller.js';

/** Applicants and the admissions pipeline: first contact, placement, offer, registration. */
@Module({
  imports: [AuditModule, SettingsModule, CatalogModule, StudentsModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class AdmissionsModule {}
