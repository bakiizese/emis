import {
  type PreRegistrationRequest,
  type PreRegistrationResponse,
  preRegistrationRequestSchema,
  preRegistrationResponseSchema,
  type PublicCatalogResponse,
  type PublicClassListResponse,
  type PublicContact,
  type PublicCourseDetail,
  publicCatalogResponseSchema,
  publicClassListResponseSchema,
  publicContactSchema,
  publicCourseDetailSchema,
} from '@emis/contracts';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { Idempotent } from '../../../common/idempotency/idempotent.decorator.js';
import { ApiZodBody, ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { Public } from '../../identity/index.js';
import { RequiresModule } from '../../settings/index.js';
import { PreRegistrationsService } from '../application/pre-registrations.service.js';
import { PublicCatalogService } from '../application/public-catalog.service.js';

const uuid = new ParseUUIDPipe({ version: '7' });
const PER_MINUTE = 60_000;
const upcomingQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(12) });

/** Everything the public website reads and writes. Anonymous, so every route is deliberate. */
@ApiTags('public')
@Controller('public')
@Public()
@RequiresModule('website')
export class PublicController {
  constructor(
    private readonly catalog: PublicCatalogService,
    private readonly preRegistrations: PreRegistrationsService,
  ) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Departments, published programs and their active courses' })
  @ApiZodResponse(200, publicCatalogResponseSchema)
  listCatalog(): Promise<PublicCatalogResponse> {
    return this.catalog.catalog();
  }

  @Get('courses/:id')
  @ApiOperation({ summary: 'One course with the classes still open to join and their seats' })
  @ApiZodResponse(200, publicCourseDetailSchema)
  course(@Param('id', uuid) id: string): Promise<PublicCourseDetail> {
    return this.catalog.courseDetail(id);
  }

  @Get('classes')
  @ApiOperation({ summary: 'The soonest classes that can still be joined' })
  @ApiZodResponse(200, publicClassListResponseSchema)
  async upcoming(
    @Query(new ZodValidationPipe(upcomingQuerySchema)) query: z.infer<typeof upcomingQuerySchema>,
  ): Promise<PublicClassListResponse> {
    return { items: await this.catalog.upcoming(query.limit) };
  }

  @Get('contact')
  @ApiOperation({ summary: 'How to reach the institution and its branches' })
  @ApiZodResponse(200, publicContactSchema)
  contact(): Promise<PublicContact> {
    return this.catalog.contact();
  }

  @Post('pre-registrations')
  @RequiresModule('pre_registration')
  @Throttle({ default: { limit: 5, ttl: PER_MINUTE } })
  @Idempotent()
  @ApiOperation({
    summary: 'Ask to join a course. Lands in the admissions queue; staff contact the applicant.',
  })
  @ApiZodBody(preRegistrationRequestSchema)
  @ApiZodResponse(201, preRegistrationResponseSchema)
  preRegister(
    @Body(new ZodValidationPipe(preRegistrationRequestSchema)) body: PreRegistrationRequest,
  ): Promise<PreRegistrationResponse> {
    return this.preRegistrations.submit(preRegistrationRequestSchema.parse(body));
  }
}
