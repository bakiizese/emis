import { SETTINGS_ERROR_CODES as c } from '@emis/contracts';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const settingsErrors = {
  codeTaken: (what: string) =>
    new ConflictException({
      code: c.codeTaken,
      message: `A ${what} with that code already exists.`,
    }),
  branchNotFound: () =>
    new NotFoundException({ code: c.branchNotFound, message: 'Branch not found.' }),
  departmentNotFound: () =>
    new NotFoundException({ code: c.departmentNotFound, message: 'Department not found.' }),
  descriptorNotFound: () =>
    new NotFoundException({ code: c.descriptorNotFound, message: 'List value not found.' }),
  customFieldNotFound: () =>
    new NotFoundException({ code: c.customFieldNotFound, message: 'Custom field not found.' }),
  unknownModule: () => new NotFoundException({ code: c.unknownModule, message: 'Unknown module.' }),
  moduleDependency: (message: string) =>
    new UnprocessableEntityException({ code: c.moduleDependency, message }),
  moduleDisabled: () =>
    new NotFoundException({
      code: c.moduleDisabled,
      message: 'This feature is switched off for this institution.',
    }),
  unknownSeries: () =>
    new NotFoundException({ code: c.unknownSeries, message: 'Unknown number series.' }),
  lastActiveBranch: () =>
    new ConflictException({
      code: c.lastActiveBranch,
      message: 'At least one branch must stay active.',
    }),
  setupCompleted: () =>
    new ConflictException({
      code: c.setupCompleted,
      message: 'Setup is already done. Change settings from the Settings pages.',
    }),
  unknownPreset: (key: string) =>
    new UnprocessableEntityException({
      code: c.unknownPreset,
      message: `Unknown preset "${key}".`,
    }),
};
