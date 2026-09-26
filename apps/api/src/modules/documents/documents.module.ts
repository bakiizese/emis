import { Module } from '@nestjs/common';

import { APP_CONFIG } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { AuditModule } from '../audit/index.js';
import { BillingModule } from '../billing/index.js';
import { CatalogModule } from '../catalog/index.js';
import { CohortsModule } from '../cohorts/index.js';
import { SettingsModule } from '../settings/index.js';
import { StudentsModule } from '../students/index.js';
import { CertificatesService } from './application/certificates.service.js';
import { DocumentContext } from './application/document-context.js';
import { ReceiptsPdfService } from './application/receipts-pdf.service.js';
import { StudentCardsService } from './application/student-cards.service.js';
import { VerificationService } from './application/verification.service.js';
import { GotenbergRenderer, PDF_RENDERER } from './infrastructure/pdf-renderer.js';
import {
  CertificatesController,
  EnrollmentCertificateController,
  ReceiptsController,
  StudentCardsController,
  VerificationController,
} from './interface/documents.controller.js';

/** Receipts, student ID cards and certificates as PDFs, and the public check that they're genuine. */
@Module({
  imports: [
    AuditModule,
    SettingsModule,
    StudentsModule,
    CatalogModule,
    CohortsModule,
    BillingModule,
  ],
  controllers: [
    ReceiptsController,
    CertificatesController,
    EnrollmentCertificateController,
    StudentCardsController,
    VerificationController,
  ],
  providers: [
    {
      provide: PDF_RENDERER,
      useFactory: (env: Env) => new GotenbergRenderer(env.GOTENBERG_URL),
      inject: [APP_CONFIG],
    },
    DocumentContext,
    ReceiptsPdfService,
    CertificatesService,
    StudentCardsService,
    VerificationService,
  ],
  exports: [CertificatesService, StudentCardsService],
})
export class DocumentsModule {}
