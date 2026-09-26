import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/index.js';
import { SettingsModule } from '../settings/index.js';
import { PostsService } from './application/posts.service.js';
import { PostsController } from './interface/posts.controller.js';

/** News, announcements and stories for the website. */
@Module({
  imports: [AuditModule, SettingsModule],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}
