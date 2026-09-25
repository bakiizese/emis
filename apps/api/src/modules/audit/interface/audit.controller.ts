import {
  type AuditListQuery,
  auditListQuerySchema,
  type AuditListResponse,
  auditListResponseSchema,
  type AuditVerifyResponse,
  auditVerifyResponseSchema,
} from '@emis/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../../common/authz/decorators.js';
import { ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { AuditService } from '../application/audit.service.js';

@ApiTags('audit')
@Controller('audit-log')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit.read')
  @ApiOperation({ summary: 'Audit trail, newest first' })
  @ApiZodResponse(200, auditListResponseSchema)
  list(
    @Query(new ZodValidationPipe(auditListQuerySchema)) query: AuditListQuery,
  ): Promise<AuditListResponse> {
    return this.audit.list(query);
  }

  @Get('verify')
  @RequirePermission('audit.read')
  @ApiOperation({ summary: 'Recompute the hash chain and report the first tampered entry, if any' })
  @ApiZodResponse(200, auditVerifyResponseSchema)
  verify(): Promise<AuditVerifyResponse> {
    return this.audit.verify();
  }
}
