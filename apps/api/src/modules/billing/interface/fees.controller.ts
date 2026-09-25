import {
  type CreateFeeStructureRequest,
  createFeeStructureRequestSchema,
  type CreatePaymentPlanRequest,
  createPaymentPlanRequestSchema,
  type FeeStructure,
  type FeeStructureListResponse,
  feeStructureListQuerySchema,
  feeStructureListResponseSchema,
  feeStructureSchema,
  type PaymentPlan,
  type PaymentPlanListResponse,
  paymentPlanListResponseSchema,
  paymentPlanSchema,
  type UpdateFeeStructureRequest,
  updateFeeStructureRequestSchema,
  type UpdatePaymentPlanRequest,
  updatePaymentPlanRequestSchema,
} from '@emis/contracts';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';

import { RequirePermission } from '../../../common/authz/decorators.js';
import { ApiIfMatch, IfMatchVersion } from '../../../common/http/versioning.js';
import { Idempotent } from '../../../common/idempotency/idempotent.decorator.js';
import { ApiZodBody, ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { type AuthContext, CurrentAuth } from '../../identity/index.js';
import { FeesService } from '../application/fees.service.js';

const uuid = new ParseUUIDPipe({ version: '7' });
const actorOf = (auth: AuthContext) => ({
  userId: auth.userId,
  email: auth.email,
  sessionId: auth.sessionId,
});

@ApiTags('billing')
@Controller('fee-structures')
export class FeeStructuresController {
  constructor(private readonly fees: FeesService) {}

  @Get()
  @RequirePermission('fees.read')
  @ApiOperation({ summary: 'Fee structures, by course and most recent first (?courseId=)' })
  @ApiZodResponse(200, feeStructureListResponseSchema)
  async list(
    @Query(new ZodValidationPipe(feeStructureListQuerySchema))
    query: z.infer<typeof feeStructureListQuerySchema>,
  ): Promise<FeeStructureListResponse> {
    return { items: await this.fees.listStructures(query.courseId) };
  }

  @Post()
  @RequirePermission('fees.manage')
  @Idempotent({ required: false })
  @ApiOperation({
    summary: 'Set a price for a course from a date. Prices are never edited, only superseded.',
  })
  @ApiZodBody(createFeeStructureRequestSchema)
  @ApiZodResponse(201, feeStructureSchema)
  create(
    @Body(new ZodValidationPipe(createFeeStructureRequestSchema)) body: CreateFeeStructureRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<FeeStructure> {
    return this.fees.createStructure(createFeeStructureRequestSchema.parse(body), actorOf(auth));
  }

  @Patch(':id')
  @RequirePermission('fees.manage')
  @ApiOperation({ summary: 'Rename or retire a fee structure' })
  @ApiIfMatch()
  @ApiZodBody(updateFeeStructureRequestSchema)
  @ApiZodResponse(200, feeStructureSchema)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateFeeStructureRequestSchema)) body: UpdateFeeStructureRequest,
    @IfMatchVersion() version: number,
    @CurrentAuth() auth: AuthContext,
  ): Promise<FeeStructure> {
    return this.fees.updateStructure(id, body, version, actorOf(auth));
  }
}

@ApiTags('billing')
@Controller('payment-plans')
export class PaymentPlansController {
  constructor(private readonly fees: FeesService) {}

  @Get()
  @RequirePermission('fees.read')
  @ApiZodResponse(200, paymentPlanListResponseSchema)
  async list(): Promise<PaymentPlanListResponse> {
    return { items: await this.fees.listPlans() };
  }

  @Post()
  @RequirePermission('fees.manage')
  @Idempotent({ required: false })
  @ApiOperation({ summary: 'Add a way of splitting an invoice into instalments' })
  @ApiZodBody(createPaymentPlanRequestSchema)
  @ApiZodResponse(201, paymentPlanSchema)
  create(
    @Body(new ZodValidationPipe(createPaymentPlanRequestSchema)) body: CreatePaymentPlanRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<PaymentPlan> {
    return this.fees.createPlan(createPaymentPlanRequestSchema.parse(body), actorOf(auth));
  }

  @Patch(':id')
  @RequirePermission('fees.manage')
  @ApiOperation({ summary: 'Rename, retire, or make a plan the default' })
  @ApiIfMatch()
  @ApiZodBody(updatePaymentPlanRequestSchema)
  @ApiZodResponse(200, paymentPlanSchema)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updatePaymentPlanRequestSchema)) body: UpdatePaymentPlanRequest,
    @IfMatchVersion() version: number,
    @CurrentAuth() auth: AuthContext,
  ): Promise<PaymentPlan> {
    return this.fees.updatePlan(id, body, version, actorOf(auth));
  }
}
