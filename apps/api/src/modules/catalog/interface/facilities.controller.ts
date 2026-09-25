import {
  type CreateRoomRequest,
  createRoomRequestSchema,
  type CreateShiftRequest,
  createShiftRequestSchema,
  type Room,
  type RoomListQuery,
  type RoomListResponse,
  roomListQuerySchema,
  roomListResponseSchema,
  roomSchema,
  type Shift,
  type ShiftListResponse,
  shiftListResponseSchema,
  shiftSchema,
  type UpdateRoomRequest,
  updateRoomRequestSchema,
  type UpdateShiftRequest,
  updateShiftRequestSchema,
} from '@emis/contracts';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../../common/authz/decorators.js';
import { ApiIfMatch, IfMatchVersion } from '../../../common/http/versioning.js';
import { Idempotent } from '../../../common/idempotency/idempotent.decorator.js';
import { ApiZodBody, ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { type AuthContext, CurrentAuth } from '../../identity/index.js';
import { FacilitiesService } from '../application/facilities.service.js';
import { actorOf } from './actor.js';

const uuid = new ParseUUIDPipe({ version: '7' });

@ApiTags('facilities')
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly facilities: FacilitiesService) {}

  @Get()
  @RequirePermission('catalog.read')
  @ApiOperation({ summary: 'Shifts (when classes run), earliest first' })
  @ApiZodResponse(200, shiftListResponseSchema)
  async list(): Promise<ShiftListResponse> {
    return { items: await this.facilities.listShifts() };
  }

  @Post()
  @RequirePermission('facilities.manage')
  @Idempotent({ required: false })
  @ApiZodBody(createShiftRequestSchema)
  @ApiZodResponse(201, shiftSchema)
  create(
    @Body(new ZodValidationPipe(createShiftRequestSchema)) body: CreateShiftRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Shift> {
    return this.facilities.createShift(createShiftRequestSchema.parse(body), actorOf(auth));
  }

  @Patch(':id')
  @RequirePermission('facilities.manage')
  @ApiOperation({ summary: 'Change a shift. Its code is fixed.' })
  @ApiIfMatch()
  @ApiZodBody(updateShiftRequestSchema)
  @ApiZodResponse(200, shiftSchema)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateShiftRequestSchema)) body: UpdateShiftRequest,
    @IfMatchVersion() version: number,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Shift> {
    return this.facilities.updateShift(
      id,
      updateShiftRequestSchema.parse(body),
      version,
      actorOf(auth),
    );
  }
}

@ApiTags('facilities')
@Controller('rooms')
export class RoomsController {
  constructor(private readonly facilities: FacilitiesService) {}

  @Get()
  @RequirePermission('catalog.read')
  @ApiOperation({ summary: 'Rooms and labs, optionally for one branch (?branchId=)' })
  @ApiZodResponse(200, roomListResponseSchema)
  async list(
    @Query(new ZodValidationPipe(roomListQuerySchema)) query: RoomListQuery,
  ): Promise<RoomListResponse> {
    return { items: await this.facilities.listRooms(query) };
  }

  @Post()
  @RequirePermission('facilities.manage')
  @Idempotent({ required: false })
  @ApiZodBody(createRoomRequestSchema)
  @ApiZodResponse(201, roomSchema)
  create(
    @Body(new ZodValidationPipe(createRoomRequestSchema)) body: CreateRoomRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Room> {
    return this.facilities.createRoom(createRoomRequestSchema.parse(body), actorOf(auth));
  }

  @Patch(':id')
  @RequirePermission('facilities.manage')
  @ApiOperation({ summary: 'Change a room. Its code and branch are fixed.' })
  @ApiIfMatch()
  @ApiZodBody(updateRoomRequestSchema)
  @ApiZodResponse(200, roomSchema)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateRoomRequestSchema)) body: UpdateRoomRequest,
    @IfMatchVersion() version: number,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Room> {
    return this.facilities.updateRoom(id, body, version, actorOf(auth));
  }
}
