import { Module } from '@nestjs/common';

import { MailModule } from '../../mail/mail.module.js';
import { AdmissionsModule } from '../admissions/index.js';
import { CatalogModule } from '../catalog/index.js';
import { CohortsModule } from '../cohorts/index.js';
import { PostsModule } from '../posts/index.js';
import { SettingsModule } from '../settings/index.js';
import { PreRegistrationsService } from './application/pre-registrations.service.js';
import { PublicCatalogService } from './application/public-catalog.service.js';
import { PublicController } from './interface/public.controller.js';

/** The read-only catalog and the pre-registration form behind the public website. */
@Module({
  imports: [
    MailModule,
    SettingsModule,
    CatalogModule,
    CohortsModule,
    AdmissionsModule,
    PostsModule,
  ],
  controllers: [PublicController],
  providers: [PublicCatalogService, PreRegistrationsService],
})
export class PublicModule {}
