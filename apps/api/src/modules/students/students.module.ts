import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/index.js';
import { SettingsModule } from '../settings/index.js';
import { DuplicatesService } from './application/duplicates.service.js';
import { StudentsService } from './application/students.service.js';
import { StudentsController } from './interface/students.controller.js';

/** Student records, their guardians, and duplicate detection. */
@Module({
  imports: [AuditModule, SettingsModule],
  controllers: [StudentsController],
  providers: [StudentsService, DuplicatesService],
  exports: [StudentsService, DuplicatesService],
})
export class StudentsModule {}
