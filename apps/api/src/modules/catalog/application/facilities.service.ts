import type {
  CreateRoomRequest,
  CreateShiftRequest,
  Room,
  RoomListQuery,
  RoomType,
  Shift,
  UpdateRoomRequest,
  UpdateShiftRequest,
} from '@emis/contracts';
import { rooms, shifts, updateWithVersion } from '@emis/db';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import { isUniqueViolation } from '../../../common/db/errors.js';
import { versionedRow } from '../../../common/http/versioning.js';
import type { Actor } from '../../../common/request/request-context.js';
import type { DbAdapter } from '../../../database/database.module.js';
import { AuditService, diffChanges } from '../../audit/index.js';
import { OrganizationService } from '../../settings/index.js';
import { catalogErrors } from '../domain/errors.js';

type ShiftRow = typeof shifts.$inferSelect;
type RoomRow = typeof rooms.$inferSelect;

/** Postgres returns `time(0)` as "17:00:00"; the API speaks "17:00". */
const hhmm = (time: string) => time.slice(0, 5);

const toShift = (row: ShiftRow): Shift => ({
  id: row.id,
  code: row.code,
  name: row.name,
  daysOfWeek: row.daysOfWeek,
  startTime: hhmm(row.startTime),
  endTime: hhmm(row.endTime),
  isActive: row.isActive,
  version: row.version,
});

const toRoom = (row: RoomRow): Room => ({
  id: row.id,
  branchId: row.branchId,
  code: row.code,
  name: row.name,
  type: row.type as RoomType,
  capacity: row.capacity,
  features: row.features,
  isActive: row.isActive,
  version: row.version,
});

/** Shifts (when classes run) and rooms (where). Institution-wide, so `facilities.manage` (Admin). */
@Injectable()
export class FacilitiesService {
  constructor(
    private readonly txHost: TransactionHost<DbAdapter>,
    private readonly org: OrganizationService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.txHost.tx;
  }

  // --- shifts --------------------------------------------------------------------------------

  async listShifts(): Promise<Shift[]> {
    const rows = await this.db
      .select()
      .from(shifts)
      .orderBy(asc(shifts.startTime), asc(shifts.name));
    return rows.map(toShift);
  }

  @Transactional()
  async createShift(input: CreateShiftRequest & { code: string }, actor: Actor): Promise<Shift> {
    let row: ShiftRow | undefined;
    try {
      [row] = await this.db
        .insert(shifts)
        .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw catalogErrors.codeTaken('shift');
      throw error;
    }
    if (!row) throw catalogErrors.shiftNotFound();
    await this.audit.record({
      action: 'shift.created',
      entityType: 'shift',
      entityId: row.id,
      changes: { code: row.code, name: row.name },
    });
    return toShift(row);
  }

  @Transactional()
  async updateShift(
    id: string,
    input: UpdateShiftRequest,
    expectedVersion: number,
    actor: Actor,
  ): Promise<Shift> {
    const [stored] = await this.db.select().from(shifts).where(eq(shifts.id, id));
    if (!stored) throw catalogErrors.shiftNotFound();
    const before = toShift(stored);

    // The request schema checks a window it was given whole; a one-sided change is checked here.
    const start = input.startTime ?? before.startTime;
    const end = input.endTime ?? before.endTime;
    if (end <= start) throw catalogErrors.invalidTimeRange();

    const row = versionedRow(
      await updateWithVersion(this.db, shifts, id, expectedVersion, {
        ...input,
        updatedBy: actor.userId,
      }),
      catalogErrors.shiftNotFound,
    );
    await this.audit.record({
      action: 'shift.updated',
      entityType: 'shift',
      entityId: id,
      changes: { code: before.code, ...diffChanges(before, input) },
    });
    return toShift(row);
  }

  // --- rooms ---------------------------------------------------------------------------------

  async listRooms(query: RoomListQuery): Promise<Room[]> {
    const rows = await this.db
      .select()
      .from(rooms)
      .where(query.branchId ? eq(rooms.branchId, query.branchId) : undefined)
      .orderBy(asc(rooms.name));
    return rows.map(toRoom);
  }

  @Transactional()
  async createRoom(input: Required<CreateRoomRequest>, actor: Actor): Promise<Room> {
    if (!(await this.org.isActiveUnit('branch', input.branchId))) {
      throw catalogErrors.branchNotFound();
    }
    let row: RoomRow | undefined;
    try {
      [row] = await this.db
        .insert(rooms)
        .values({ ...input, createdBy: actor.userId, updatedBy: actor.userId })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw catalogErrors.codeTaken('room in this branch');
      throw error;
    }
    if (!row) throw catalogErrors.roomNotFound();
    await this.audit.record({
      action: 'room.created',
      entityType: 'room',
      entityId: row.id,
      changes: { code: row.code, name: row.name, branchId: row.branchId, capacity: row.capacity },
    });
    return toRoom(row);
  }

  @Transactional()
  async updateRoom(
    id: string,
    input: UpdateRoomRequest,
    expectedVersion: number,
    actor: Actor,
  ): Promise<Room> {
    const [before] = await this.db.select().from(rooms).where(eq(rooms.id, id));
    if (!before) throw catalogErrors.roomNotFound();

    const row = versionedRow(
      await updateWithVersion(this.db, rooms, id, expectedVersion, {
        ...input,
        updatedBy: actor.userId,
      }),
      catalogErrors.roomNotFound,
    );
    await this.audit.record({
      action: 'room.updated',
      entityType: 'room',
      entityId: id,
      changes: { code: before.code, ...diffChanges(before, input) },
    });
    return toRoom(row);
  }
}
