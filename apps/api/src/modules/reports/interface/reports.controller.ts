import {
  type OutstandingItemsQuery,
  type OutstandingItemsResponse,
  type OutstandingQuery,
  type OutstandingResponse,
  outstandingItemsQuerySchema,
  outstandingItemsResponseSchema,
  outstandingQuerySchema,
  outstandingResponseSchema,
  type RevenueQuery,
  type RevenueResponse,
  revenueQuerySchema,
  revenueResponseSchema,
} from '@emis/contracts';
import type { Grant } from '@emis/permissions';
import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';

import { CurrentGrants, RequirePermission } from '../../../common/authz/decorators.js';
import { ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { type CsvFile, ReportsService } from '../application/reports.service.js';

/** A download that is never cached or sniffed: it carries names and money. */
const csv = (file: CsvFile) =>
  new StreamableFile(Buffer.from(file.content, 'utf8'), {
    type: 'text/csv; charset=utf-8',
    disposition: `attachment; filename="${file.filename.replace(/[^\w.-]/g, '_')}"`,
  });

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('revenue')
  @RequirePermission('reports.finance')
  @ApiOperation({
    summary:
      'Payments received in a date range, grouped by day, month, branch, department, program or method. Voided payments are left out of the totals and shown separately.',
  })
  @ApiZodResponse(200, revenueResponseSchema)
  revenue(
    @Query(new ZodValidationPipe(revenueQuerySchema)) query: RevenueQuery,
    @CurrentGrants() grants: Grant[],
  ): Promise<RevenueResponse> {
    return this.reports.revenue(revenueQuerySchema.parse(query), grants);
  }

  @Get('revenue.csv')
  @RequirePermission('reports.finance')
  @ApiOperation({ summary: 'The revenue report as a CSV file (same filters)' })
  @ApiProduces('text/csv')
  async revenueCsv(
    @Query(new ZodValidationPipe(revenueQuerySchema)) query: RevenueQuery,
    @CurrentGrants() grants: Grant[],
  ): Promise<StreamableFile> {
    return csv(await this.reports.revenueCsv(revenueQuerySchema.parse(query), grants));
  }

  @Get('outstanding')
  @RequirePermission('reports.finance')
  @ApiOperation({
    summary:
      'Unpaid instalments grouped by how overdue they are: not due, 1–30, 31–60, 61–90, over 90 days',
  })
  @ApiZodResponse(200, outstandingResponseSchema)
  outstanding(
    @Query(new ZodValidationPipe(outstandingQuerySchema)) query: OutstandingQuery,
    @CurrentGrants() grants: Grant[],
  ): Promise<OutstandingResponse> {
    return this.reports.outstanding(query, grants);
  }

  @Get('outstanding/items')
  @RequirePermission('reports.finance')
  @ApiOperation({ summary: 'The unpaid instalments behind the aging buckets, oldest first' })
  @ApiZodResponse(200, outstandingItemsResponseSchema)
  outstandingItems(
    @Query(new ZodValidationPipe(outstandingItemsQuerySchema)) query: OutstandingItemsQuery,
    @CurrentGrants() grants: Grant[],
  ): Promise<OutstandingItemsResponse> {
    return this.reports.outstandingItems(query, grants);
  }

  @Get('outstanding.csv')
  @RequirePermission('reports.finance')
  @ApiOperation({ summary: 'Every unpaid instalment as a CSV file (up to 50,000 rows)' })
  @ApiProduces('text/csv')
  async outstandingCsv(
    @Query(new ZodValidationPipe(outstandingQuerySchema)) query: OutstandingQuery,
    @CurrentGrants() grants: Grant[],
  ): Promise<StreamableFile> {
    return csv(await this.reports.outstandingCsv(query, grants));
  }
}
