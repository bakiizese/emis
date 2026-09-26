import {
  type CreatePostRequest,
  createPostRequestSchema,
  type Post,
  type PostListQuery,
  type PostListResponse,
  postListQuerySchema,
  postListResponseSchema,
  postSchema,
  type PublishPostRequest,
  publishPostRequestSchema,
  type UpdatePostRequest,
  updatePostRequestSchema,
} from '@emis/contracts';
import type { Grant } from '@emis/permissions';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post as HttpPost,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentGrants, RequirePermission } from '../../../common/authz/decorators.js';
import { ApiIfMatch, IfMatchVersion } from '../../../common/http/versioning.js';
import { Idempotent } from '../../../common/idempotency/idempotent.decorator.js';
import { ApiZodBody, ApiZodResponse } from '../../../common/zod/openapi.js';
import { ZodValidationPipe } from '../../../common/zod/zod-validation.js';
import { type AuthContext, CurrentAuth } from '../../identity/index.js';
import { RequiresModule } from '../../settings/index.js';
import { PostsService } from '../application/posts.service.js';

const uuid = new ParseUUIDPipe({ version: '7' });
const actorOf = (auth: AuthContext) => ({
  userId: auth.userId,
  email: auth.email,
  sessionId: auth.sessionId,
});

@ApiTags('posts')
@Controller('posts')
@RequiresModule('news')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  @RequirePermission('posts.read')
  @ApiOperation({
    summary: 'News and announcements with drafts, newest first (?status=, ?kind=, ?q=)',
  })
  @ApiZodResponse(200, postListResponseSchema)
  list(
    @Query(new ZodValidationPipe(postListQuerySchema)) query: PostListQuery,
  ): Promise<PostListResponse> {
    return this.posts.list(query);
  }

  @Get(':id')
  @RequirePermission('posts.read')
  @ApiZodResponse(200, postSchema)
  get(@Param('id', uuid) id: string): Promise<Post> {
    return this.posts.get(id);
  }

  @HttpPost()
  @RequirePermission('posts.manage')
  @Idempotent()
  @ApiOperation({ summary: 'Write a new draft' })
  @ApiZodBody(createPostRequestSchema)
  @ApiZodResponse(201, postSchema)
  create(
    @Body(new ZodValidationPipe(createPostRequestSchema)) body: CreatePostRequest,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Post> {
    return this.posts.create(createPostRequestSchema.parse(body), actorOf(auth));
  }

  @Patch(':id')
  @RequirePermission('posts.manage')
  @ApiOperation({
    summary: 'Edit a post. A post that is live or scheduled can only be edited by a publisher.',
  })
  @ApiIfMatch()
  @ApiZodBody(updatePostRequestSchema)
  @ApiZodResponse(200, postSchema)
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updatePostRequestSchema)) body: UpdatePostRequest,
    @IfMatchVersion() version: number,
    @CurrentGrants() grants: Grant[],
    @CurrentAuth() auth: AuthContext,
  ): Promise<Post> {
    return this.posts.update(id, body, version, grants, actorOf(auth));
  }

  @HttpPost(':id/publish')
  @HttpCode(200)
  @RequirePermission('posts.publish')
  @ApiOperation({ summary: 'Publish now, or schedule for a later time' })
  @ApiIfMatch()
  @ApiZodBody(publishPostRequestSchema)
  @ApiZodResponse(200, postSchema)
  publish(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(publishPostRequestSchema)) body: PublishPostRequest,
    @IfMatchVersion() version: number,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Post> {
    return this.posts.publish(id, publishPostRequestSchema.parse(body), version, actorOf(auth));
  }

  @HttpPost(':id/unpublish')
  @HttpCode(200)
  @RequirePermission('posts.publish')
  @ApiOperation({ summary: 'Take a post off the website and back to draft' })
  @ApiIfMatch()
  @ApiZodResponse(200, postSchema)
  unpublish(
    @Param('id', uuid) id: string,
    @IfMatchVersion() version: number,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Post> {
    return this.posts.unpublish(id, version, actorOf(auth));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('posts.manage')
  @ApiOperation({ summary: 'Delete a draft. Deleting a live or scheduled post needs a publisher.' })
  remove(@Param('id', uuid) id: string, @CurrentGrants() grants: Grant[]): Promise<void> {
    return this.posts.remove(id, grants);
  }
}
