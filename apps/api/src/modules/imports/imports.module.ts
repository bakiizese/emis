import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/index.js';
import { SettingsModule } from '../settings/index.js';
import { StudentsModule } from '../students/index.js';
import { StudentImportService } from './application/student-import.service.js';
import { ImportsController } from './interface/imports.controller.js';

/** Bulk loading of records from files (students for now). */
@Module({
  imports: [AuditModule, SettingsModule, StudentsModule],
  controllers: [ImportsController],
  providers: [StudentImportService],
})
export class ImportsModule {}
