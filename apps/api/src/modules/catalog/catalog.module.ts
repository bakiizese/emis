import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/index.js';
import { SettingsModule } from '../settings/index.js';
import { CalendarService } from './application/calendar.service.js';
import { CoursesService } from './application/courses.service.js';
import { FacilitiesService } from './application/facilities.service.js';
import { ProgramsService } from './application/programs.service.js';
import {
  AcademicYearsController,
  HolidaysController,
  IntakesController,
} from './interface/calendar.controller.js';
import { RoomsController, ShiftsController } from './interface/facilities.controller.js';
import { CoursesController, ProgramsController } from './interface/programs.controller.js';

/**
 * What the institution teaches and when and where: programs, courses (levels) with prerequisites
 * and completion rules, the academic calendar, shifts and rooms.
 */
@Module({
  imports: [AuditModule, SettingsModule],
  controllers: [
    ProgramsController,
    CoursesController,
    AcademicYearsController,
    IntakesController,
    HolidaysController,
    ShiftsController,
    RoomsController,
  ],
  providers: [ProgramsService, CoursesService, CalendarService, FacilitiesService],
  exports: [ProgramsService, CoursesService, CalendarService, FacilitiesService],
})
export class CatalogModule {}
