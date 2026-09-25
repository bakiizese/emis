import { Module } from '@nestjs/common';

import { AuditService } from './application/audit.service.js';
import { AuditController } from './interface/audit.controller.js';

@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
