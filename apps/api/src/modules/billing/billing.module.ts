import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/index.js';
import { CatalogModule } from '../catalog/index.js';
import { CohortsModule } from '../cohorts/index.js';
import { SettingsModule } from '../settings/index.js';
import { StudentsModule } from '../students/index.js';
import { ApprovalsService } from './application/approvals.service.js';
import { FeesService } from './application/fees.service.js';
import { InvoicesService } from './application/invoices.service.js';
import { PAYMENT_PROVIDERS, PaymentsService } from './application/payments.service.js';
import { defaultProviders } from './domain/providers.js';
import {
  InvoicesController,
  PaymentsController,
  ApprovalsController,
} from './interface/billing.controller.js';
import { FeeStructuresController, PaymentPlansController } from './interface/fees.controller.js';

/**
 * Fees, invoices, payments, receipts, and the approvals that guard discounts and voids. Money is
 * whole santim throughout. Only the Manual payment provider exists; see domain/providers.ts.
 */
@Module({
  imports: [AuditModule, SettingsModule, CatalogModule, StudentsModule, CohortsModule],
  controllers: [
    FeeStructuresController,
    PaymentPlansController,
    InvoicesController,
    PaymentsController,
    ApprovalsController,
  ],
  providers: [
    { provide: PAYMENT_PROVIDERS, useFactory: defaultProviders },
    FeesService,
    InvoicesService,
    PaymentsService,
    ApprovalsService,
  ],
  exports: [FeesService, InvoicesService, PaymentsService, ApprovalsService],
})
export class BillingModule {}
