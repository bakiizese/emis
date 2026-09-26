import {
  type Certificate,
  type CertificateListQuery,
  type CertificateListResponse,
  certificateListQuerySchema,
  certificateListResponseSchema,
  certificateSchema,
  type ReceiptFormat,
  receiptQuerySchema,
  type RevokeCertificateRequest,
  revokeCertificateRequestSchema,
  type StudentCard,
  studentCardSchema,
  type Verification,
  verificationSchema,
  verificationTokenSchema,
} from '@emis/contracts';
import type { Grant } from '@emis/permissions';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentGrants, RequirePermission } from '../../../common/authz/decorators.js';
import { ApiIfMatch, IfMatchVersion } from '../../../common/http/versioning.js';
import { Idempotent } from '../../../common/idempotency/idempotent.decorator.js';
import { ApiZodBody, ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { type AuthContext, CurrentAuth, Public } from '../../identity/index.js';
import { RequiresModule } from '../../settings/index.js';
import { CertificatesService } from '../application/certificates.service.js';
import { ReceiptsPdfService } from '../application/receipts-pdf.service.js';
import { StudentCardsService } from '../application/student-cards.service.js';
import { VerificationService } from '../application/verification.service.js';

const uuid = new ParseUUIDPipe({ version: '7' });
const actorOf = (auth: AuthContext) => ({
  userId: auth.userId,
  email: auth.email,
  sessionId: auth.sessionId,
});

/** A PDF straight to the browser, shown inline and never cached (it may carry personal details). */
const pdf = (file: { pdf: Buffer; filename: string }) =>
  new StreamableFile(file.pdf, {
    type: 'application/pdf',
    disposition: `inline; filename="${file.filename.replace(/[^\w.-]/g, '_')}"`,
  });

@ApiTags('documents')
@Controller('payments')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsPdfService) {}

  @Get(':id/receipt')
  @RequirePermission('billing.read')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'The receipt as a PDF: ?format=a5 (default) or thermal (80 mm)' })
  @ApiProduces('application/pdf')
  async receipt(
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(receiptQuerySchema)) query: { format: ReceiptFormat },
    @CurrentGrants() grants: Grant[],
  ): Promise<StreamableFile> {
    return pdf(await this.receipts.render(id, query.format, grants));
  }
}

@ApiTags('documents')
@Controller('certificates')
@RequiresModule('certificates')
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get()
  @RequirePermission('certificates.read')
  @ApiOperation({ summary: 'Certificates, newest first (?studentId=, ?status=)' })
  @ApiZodResponse(200, certificateListResponseSchema)
  list(
    @Query(new ZodValidationPipe(certificateListQuerySchema)) query: CertificateListQuery,
    @CurrentGrants() grants: Grant[],
  ): Promise<CertificateListResponse> {
    return this.certificates.list(query, grants);
  }

  @Get(':id')
  @RequirePermission('certificates.read')
  @ApiZodResponse(200, certificateSchema)
  get(@Param('id', uuid) id: string, @CurrentGrants() grants: Grant[]): Promise<Certificate> {
    return this.certificates.get(id, grants);
  }

  @Get(':id/pdf')
  @RequirePermission('certificates.read')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'The certificate as an A4 landscape PDF with its verification QR code' })
  @ApiProduces('application/pdf')
  async pdf(
    @Param('id', uuid) id: string,
    @CurrentGrants() grants: Grant[],
  ): Promise<StreamableFile> {
    return pdf(await this.certificates.pdf(id, grants));
  }

  @Post(':id/revoke')
  @RequirePermission('certificates.revoke')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke a certificate: it stays on record but no longer verifies' })
  @ApiIfMatch()
  @ApiZodBody(revokeCertificateRequestSchema)
  @ApiZodResponse(200, certificateSchema)
  revoke(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(revokeCertificateRequestSchema)) body: RevokeCertificateRequest,
    @IfMatchVersion() version: number,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Certificate> {
    return this.certificates.revoke(id, body.reason, version, grants, actorOf(auth));
  }
}

@ApiTags('documents')
@Controller('enrollments')
export class EnrollmentCertificateController {
  constructor(private readonly certificates: CertificatesService) {}

  @Post(':id/certificate')
  @RequirePermission('certificates.issue')
  @RequiresModule('certificates')
  @Idempotent({ required: false })
  @ApiOperation({
    summary:
      'Issue the certificate for a completed enrollment (if the course awards one and any fee policy is met)',
  })
  @ApiZodResponse(201, certificateSchema)
  issue(
    @Param('id', uuid) id: string,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Certificate> {
    return this.certificates.issue(id, grants, actorOf(auth));
  }
}

@ApiTags('documents')
@Controller('students')
@RequiresModule('student_ids')
export class StudentCardsController {
  constructor(private readonly cards: StudentCardsService) {}

  @Get(':id/id-card')
  @RequirePermission('students.read')
  @ApiOperation({ summary: "The student's current ID card, or null if none has been issued" })
  @ApiZodResponse(200, studentCardSchema.nullable())
  async current(
    @Param('id', uuid) id: string,
    @CurrentGrants() grants: Grant[],
  ): Promise<StudentCard | null> {
    return this.cards.current(id, grants);
  }

  @Post(':id/id-card')
  @RequirePermission('students.manage')
  @Idempotent({ required: false })
  @ApiOperation({
    summary: 'Issue an ID card. Any earlier card is revoked, so it stops verifying.',
  })
  @ApiZodResponse(201, studentCardSchema)
  issue(
    @Param('id', uuid) id: string,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<StudentCard> {
    return this.cards.issue(id, grants, actorOf(auth));
  }

  @Get(':id/id-card/pdf')
  @RequirePermission('students.read')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'The ID card as a CR80 (credit-card size) PDF' })
  @ApiProduces('application/pdf')
  async pdf(
    @Param('id', uuid) id: string,
    @CurrentGrants() grants: Grant[],
  ): Promise<StreamableFile> {
    return pdf(await this.cards.pdf(id, grants));
  }
}

@ApiTags('verification')
@Controller('verify')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get(':token')
  @Public()
  // Tokens are 256 random bits, so guessing is hopeless; this keeps anyone from even trying at speed.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Public: check a certificate or ID card from the code on it. Shows only what is printed on the document.',
  })
  @ApiZodResponse(200, verificationSchema)
  verify(
    @Param('token', new ZodValidationPipe(verificationTokenSchema)) token: string,
  ): Promise<Verification> {
    return this.verification.verify(token);
  }
}
