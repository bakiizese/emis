import {
  type AcademicYear,
  type AcademicYearListResponse,
  academicYearListResponseSchema,
  academicYearSchema,
  type CreateAcademicYearRequest,
  createAcademicYearRequestSchema,
  type CreateHolidayRequest,
  createHolidayRequestSchema,
  type CreateIntakeRequest,
  createIntakeRequestSchema,
  type Holiday,
  type HolidayListResponse,
  holidayListResponseSchema,
  holidaySchema,
  type Intake,
  type IntakeListQuery,
  type IntakeListResponse,
  intakeListQuerySchema,
  intakeListResponseSchema,
  intakeSchema,
  type UpdateAcademicYearRequest,
  updateAcademicYearRequestSchema,
  type UpdateHolidayRequest,
  updateHolidayRequestSchema,
  type UpdateIntakeRequest,
  updateIntakeRequestSchema,
} from '@emis/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../../common/authz/decorators.js';
import { ApiIfMatch, IfMatchVersion } from '../../../common/http/versioning.js';
import { Idempotent } from '../../../common/idempotency/idempotent.decorator.js';
import { ApiZodBody, ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { type AuthContext, CurrentAuth } from '../../identity/index.js';
import { CalendarService } from '../application/calendar.service.js';
import { actorOf } from './actor.js';

const uuid = new ParseUUIDPipe({ version: '7' });

@ApiTags('calendar')
@Controller('academic-years')
export class AcademicYearsController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @RequirePermission('catalog.read')
  @ApiOperation({ summary: 'Academic years, newest first' })
  @ApiZodResponse(200, academicYearListResponseSchema)
  async list(): Promise<AcademicYearListResponse> {
    return { items: await this.calendar.listYears() };
  }

  @Post()
  @RequirePermission('calendar.manage')
  @Idempotent({ required: false })
  @ApiOperation({ summary: 'Add an academic year. Years may not overlap.' })
  @ApiZodBody(createAcademicYearRequestSchema)
  @ApiZodResponse(201, academicYearSchema)
  create(
    @Body(new ZodValidationPipe(createAcademicYearRequestSchema)) body: CreateAcademicYearRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<AcademicYear> {
    return this.calendar.createYear(body, actorOf(auth));
  }

  @Patch(':id')
  @RequirePermission('calendar.manage')
  @ApiIfMatch()
  @ApiZodBody(updateAcademicYearRequestSchema)
  @ApiZodResponse(200, academicYearSchema)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateAcademicYearRequestSchema)) body: UpdateAcademicYearRequest,
    @IfMatchVersion() version: number,
    @CurrentAuth() auth: AuthContext,
  ): Promise<AcademicYear> {
    return this.calendar.updateYear(id, body, version, actorOf(auth));
  }
}

@ApiTags('calendar')
@Controller('intakes')
export class IntakesController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @RequirePermission('catalog.read')
  @ApiOperation({ summary: 'Intakes, newest first (optionally ?programId=)' })
  @ApiZodResponse(200, intakeListResponseSchema)
  async list(
    @Query(new ZodValidationPipe(intakeListQuerySchema)) query: IntakeListQuery,
  ): Promise<IntakeListResponse> {
    return { items: await this.calendar.listIntakes(query) };
  }

  @Post()
  @RequirePermission('calendar.manage')
  @Idempotent({ required: false })
  @ApiZodBody(createIntakeRequestSchema)
  @ApiZodResponse(201, intakeSchema)
  create(
    @Body(new ZodValidationPipe(createIntakeRequestSchema)) body: CreateIntakeRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Intake> {
    return this.calendar.createIntake(createIntakeRequestSchema.parse(body), actorOf(auth));
  }

  @Patch(':id')
  @RequirePermission('calendar.manage')
  @ApiIfMatch()
  @ApiZodBody(updateIntakeRequestSchema)
  @ApiZodResponse(200, intakeSchema)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateIntakeRequestSchema)) body: UpdateIntakeRequest,
    @IfMatchVersion() version: number,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Intake> {
    return this.calendar.updateIntake(
      id,
      updateIntakeRequestSchema.parse(body),
      version,
      actorOf(auth),
    );
  }
}

@ApiTags('calendar')
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @RequirePermission('catalog.read')
  @ApiOperation({ summary: 'Holidays in date order' })
  @ApiZodResponse(200, holidayListResponseSchema)
  async list(): Promise<HolidayListResponse> {
    return { items: await this.calendar.listHolidays() };
  }

  @Post()
  @RequirePermission('calendar.manage')
  @Idempotent({ required: false })
  @ApiZodBody(createHolidayRequestSchema)
  @ApiZodResponse(201, holidaySchema)
  create(
    @Body(new ZodValidationPipe(createHolidayRequestSchema)) body: CreateHolidayRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Holiday> {
    return this.calendar.createHoliday(createHolidayRequestSchema.parse(body), actorOf(auth));
  }

  @Patch(':id')
  @RequirePermission('calendar.manage')
  @ApiIfMatch()
  @ApiZodBody(updateHolidayRequestSchema)
  @ApiZodResponse(200, holidaySchema)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateHolidayRequestSchema)) body: UpdateHolidayRequest,
    @IfMatchVersion() version: number,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Holiday> {
    return this.calendar.updateHoliday(id, body, version, actorOf(auth));
  }

  @Delete(':id')
  @RequirePermission('calendar.manage')
  @HttpCode(204)
  async remove(@Param('id', uuid) id: string): Promise<void> {
    await this.calendar.deleteHoliday(id);
  }
}
