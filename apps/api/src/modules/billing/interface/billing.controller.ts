import {
  type Approval,
  type ApprovalListQuery,
  type ApprovalListResponse,
  approvalListQuerySchema,
  approvalListResponseSchema,
  approvalSchema,
  type CreateInvoiceRequest,
  createInvoiceRequestSchema,
  type DecideApprovalRequest,
  decideApprovalRequestSchema,
  type Invoice,
  type InvoiceListQuery,
  type InvoiceListResponse,
  invoiceListQuerySchema,
  invoiceListResponseSchema,
  invoiceSchema,
  type Payment,
  type PaymentListQuery,
  type PaymentListResponse,
  paymentListQuerySchema,
  paymentListResponseSchema,
  paymentSchema,
  type RecordPaymentRequest,
  recordPaymentRequestSchema,
  type RequestDiscount,
  type RequestVoid,
  requestDiscountSchema,
  requestVoidSchema,
} from '@emis/contracts';
import type { Grant } from '@emis/permissions';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentGrants, RequirePermission } from '../../../common/authz/decorators.js';
import { Idempotent } from '../../../common/idempotency/idempotent.decorator.js';
import { ApiZodBody, ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { type AuthContext, CurrentAuth } from '../../identity/index.js';
import { ApprovalsService } from '../application/approvals.service.js';
import { InvoicesService } from '../application/invoices.service.js';
import { PaymentsService } from '../application/payments.service.js';

const uuid = new ParseUUIDPipe({ version: '7' });
const actorOf = (auth: AuthContext) => ({
  userId: auth.userId,
  email: auth.email,
  sessionId: auth.sessionId,
});

@ApiTags('billing')
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly approvals: ApprovalsService,
  ) {}

  @Get()
  @RequirePermission('billing.read')
  @ApiOperation({ summary: 'Invoices, newest first (?studentId=, ?stage=unpaid|settled, ?q=)' })
  @ApiZodResponse(200, invoiceListResponseSchema)
  list(
    @Query(new ZodValidationPipe(invoiceListQuerySchema)) query: InvoiceListQuery,
    @CurrentGrants() grants: Grant[],
  ): Promise<InvoiceListResponse> {
    return this.invoices.list(query, grants);
  }

  @Get(':id')
  @RequirePermission('billing.read')
  @ApiZodResponse(200, invoiceSchema)
  get(@Param('id', uuid) id: string, @CurrentGrants() grants: Grant[]): Promise<Invoice> {
    return this.invoices.get(id, grants);
  }

  @Post()
  @RequirePermission('billing.invoice')
  @Idempotent()
  @ApiOperation({
    summary: 'Invoice an enrollment: prices the course and splits it by a payment plan',
  })
  @ApiZodBody(createInvoiceRequestSchema)
  @ApiZodResponse(201, invoiceSchema)
  create(
    @Body(new ZodValidationPipe(createInvoiceRequestSchema)) body: CreateInvoiceRequest,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Invoice> {
    return this.invoices.create(createInvoiceRequestSchema.parse(body), grants, actorOf(auth));
  }

  @Post(':id/discount-requests')
  @RequirePermission('billing.request')
  @Idempotent({ required: false })
  @ApiOperation({ summary: 'Ask for a discount. It applies only when someone else approves it.' })
  @ApiZodBody(requestDiscountSchema)
  @ApiZodResponse(201, approvalSchema)
  requestDiscount(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(requestDiscountSchema)) body: RequestDiscount,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Approval> {
    return this.approvals.requestDiscount(
      id,
      requestDiscountSchema.parse(body),
      grants,
      actorOf(auth),
    );
  }
}

@ApiTags('billing')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly approvals: ApprovalsService,
  ) {}

  @Get()
  @RequirePermission('billing.read')
  @ApiOperation({ summary: 'Payments and their receipts, newest first' })
  @ApiZodResponse(200, paymentListResponseSchema)
  list(
    @Query(new ZodValidationPipe(paymentListQuerySchema)) query: PaymentListQuery,
    @CurrentGrants() grants: Grant[],
  ): Promise<PaymentListResponse> {
    return this.payments.list(query, grants);
  }

  @Get(':id')
  @RequirePermission('billing.read')
  @ApiZodResponse(200, paymentSchema)
  get(@Param('id', uuid) id: string, @CurrentGrants() grants: Grant[]): Promise<Payment> {
    return this.payments.get(id, grants);
  }

  @Post()
  @RequirePermission('billing.receive')
  @Idempotent()
  @ApiOperation({
    summary:
      'Record a cash, bank transfer or cheque payment. Applies to the oldest instalments first and issues a receipt.',
  })
  @ApiZodBody(recordPaymentRequestSchema)
  @ApiZodResponse(201, paymentSchema)
  record(
    @Body(new ZodValidationPipe(recordPaymentRequestSchema)) body: RecordPaymentRequest,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Payment> {
    return this.payments.record(recordPaymentRequestSchema.parse(body), grants, actorOf(auth));
  }

  @Post(':id/void-requests')
  @RequirePermission('billing.request')
  @Idempotent({ required: false })
  @ApiOperation({
    summary: 'Ask for a payment to be voided. It is only voided when someone else approves.',
  })
  @ApiZodBody(requestVoidSchema)
  @ApiZodResponse(201, approvalSchema)
  requestVoid(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(requestVoidSchema)) body: RequestVoid,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Approval> {
    return this.approvals.requestVoid(id, body, grants, actorOf(auth));
  }
}

@ApiTags('billing')
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  @RequirePermission('billing.request')
  @ApiOperation({
    summary: 'Requests waiting for (or past) a decision. Deciders see all; others see their own.',
  })
  @ApiZodResponse(200, approvalListResponseSchema)
  list(
    @Query(new ZodValidationPipe(approvalListQuerySchema)) query: ApprovalListQuery,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<ApprovalListResponse> {
    return this.approvals.list(query, grants, actorOf(auth));
  }

  @Post(':id/decision')
  @RequirePermission('approvals.decide')
  @HttpCode(200)
  @ApiOperation({
    summary: "Approve (which makes the change) or reject. You can't decide your own request.",
  })
  @ApiZodBody(decideApprovalRequestSchema)
  @ApiZodResponse(200, approvalSchema)
  decide(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(decideApprovalRequestSchema)) body: DecideApprovalRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Approval> {
    return this.approvals.decide(id, decideApprovalRequestSchema.parse(body), actorOf(auth));
  }
}
