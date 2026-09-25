import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/index.js';
import { CustomFieldsService } from './application/custom-fields.service.js';
import { DescriptorsService } from './application/descriptors.service.js';
import { InstitutionService } from './application/institution.service.js';
import { ModulesService } from './application/modules.service.js';
import { NumberingService } from './application/numbering.service.js';
import { OrganizationService } from './application/organization.service.js';
import { SetupService } from './application/setup.service.js';
import { TerminologyService } from './application/terminology.service.js';
import {
  CustomFieldsController,
  DescriptorsController,
  ModulesController,
  NumberSeriesController,
  TerminologyController,
} from './interface/configuration.controller.js';
import { InstitutionController } from './interface/institution.controller.js';
import { ModuleGuard } from './interface/module.guard.js';
import { BranchesController, DepartmentsController } from './interface/organization.controller.js';
import { SetupController } from './interface/setup.controller.js';

/**
 * What makes one install fit one institution: profile and branding, branches, departments,
 * module switches, dropdown lists, custom fields, wording and numbering, plus first-run setup.
 */
@Module({
  imports: [AuditModule],
  controllers: [
    InstitutionController,
    BranchesController,
    DepartmentsController,
    ModulesController,
    DescriptorsController,
    CustomFieldsController,
    TerminologyController,
    NumberSeriesController,
    SetupController,
  ],
  providers: [
    InstitutionService,
    OrganizationService,
    ModulesService,
    DescriptorsService,
    CustomFieldsService,
    TerminologyService,
    NumberingService,
    SetupService,
    ModuleGuard,
  ],
  exports: [
    InstitutionService,
    OrganizationService,
    ModulesService,
    DescriptorsService,
    CustomFieldsService,
    NumberingService,
    ModuleGuard,
  ],
})
export class SettingsModule {}
