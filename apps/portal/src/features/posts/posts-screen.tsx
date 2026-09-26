'use client';

import {
  createPostRequestSchema,
  POST_BODY_MAX,
  POST_KINDS,
  type Post,
  postListResponseSchema,
  postSchema,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { SelectField } from '@emis/ui/components/select';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';

import { SectionHeader } from '@/components/section-header';
import { SimpleTable } from '@/components/simple-table';
import { useInstitution } from '@/features/institution/use-institution';
import { useSession } from '@/features/session/use-session';
import { apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

import { isoToLocalInput, localInputToIso } from './post-time';

type FormInput = z.input<typeof createPostRequestSchema>;
type FormOutput = z.output<typeof createPostRequestSchema>;

const KIND_LABELS = { announcement: 'Announcement', news: 'News', story: 'Story' } as const;
const STATUS_TONE = { draft: 'neutral', scheduled: 'warning', published: 'success' } as const;

function PostForm({ editing, onDone }: { editing: Post | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const idempotency = useIdempotencyKey();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createPostRequestSchema),
    defaultValues: {
      title: editing?.title ?? '',
      kind: editing?.kind ?? 'news',
      summary: editing?.summary ?? '',
      body: editing?.body ?? '',
    },
  });
  const { errors } = form.formState;
  const bodyLength = (useWatch({ control: form.control, name: 'body' }) ?? '').length;

  const save = useMutation({
    mutationFn: (values: FormOutput) =>
      editing
        ? apiRequest(`/posts/${editing.id}`, {
            method: 'PATCH',
            body: values,
            schema: postSchema,
            ifMatch: editing.version,
          })
        : apiRequest('/posts', {
            method: 'POST',
            body: values,
            schema: postSchema,
            idempotencyKey: idempotency.keyFor(values),
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['posts'] });
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{editing ? 'Edit post' : 'New post'}</CardTitle>
      </CardHeader>
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
      >
        <div className="sm:col-span-2">
          <Field label="Title" error={errors.title?.message} {...form.register('title')} />
        </div>
        <SelectField label="Kind" error={errors.kind?.message} {...form.register('kind')}>
          {POST_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </SelectField>
        <Field
          label="Summary"
          hint="One or two lines shown in lists. Optional."
          error={errors.summary?.message}
          {...form.register('summary')}
        />
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="post-body" className="text-sm font-medium">
            Text
          </label>
          <textarea
            id="post-body"
            rows={12}
            aria-invalid={errors.body ? true : undefined}
            className="border-border bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none aria-invalid:border-red-600"
            {...form.register('body')}
          />
          <p className="text-muted-foreground text-sm">
            Plain text. Leave a blank line between paragraphs. {bodyLength.toLocaleString()} /{' '}
            {POST_BODY_MAX.toLocaleString()}
          </p>
          {errors.body ? (
            <p className="text-sm text-red-700 dark:text-red-300">{errors.body.message}</p>
          ) : null}
        </div>
        {save.error ? (
          <Alert tone="error" className="sm:col-span-2">
            {errorMessage(save.error)}
          </Alert>
        ) : null}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PublishPanel({ post, onDone }: { post: Post; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState(post.publishAt ? isoToLocalInput(post.publishAt) : '');
  const iso = localInputToIso(at);

  const publish = useMutation({
    mutationFn: () =>
      apiRequest(`/posts/${post.id}/publish`, {
        method: 'POST',
        body: { publishAt: when === 'later' ? iso : null },
        schema: postSchema,
        ifMatch: post.version,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['posts'] });
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Publish “{post.title}”</CardTitle>
      </CardHeader>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={when === 'now'} onChange={() => setWhen('now')} /> Now
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={when === 'later'} onChange={() => setWhen('later')} /> At a
            set time
          </label>
        </div>
        {when === 'later' ? (
          <Field
            label="Publish at"
            type="datetime-local"
            value={at}
            onChange={(event) => setAt(event.target.value)}
            hint="In your time zone. It goes live by itself at that moment."
          />
        ) : null}
        {publish.error ? <Alert tone="error">{errorMessage(publish.error)}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button
            disabled={publish.isPending || (when === 'later' && iso === null)}
            onClick={() => publish.mutate()}
          >
            {when === 'later' ? 'Schedule' : 'Publish now'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function PostsScreen() {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const { profile } = useInstitution();
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Post | 'new' | null>(null);
  const [publishing, setPublishing] = useState<Post | null>(null);
  const canManage = can('posts.manage');
  const canPublish = can('posts.publish');

  const posts = useInfiniteQuery({
    queryKey: ['posts', 'list', status],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        limit: '25',
        ...(status ? { status } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      });
      return apiRequest(`/posts?${params.toString()}`, { schema: postListResponseSchema });
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const rows = posts.data?.pages.flatMap((page) => page.items) ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['posts'] });
  const unpublish = useMutation({
    mutationFn: (post: Post) =>
      apiRequest(`/posts/${post.id}/unpublish`, {
        method: 'POST',
        schema: postSchema,
        ifMatch: post.version,
      }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (post: Post) => apiRequest(`/posts/${post.id}`, { method: 'DELETE' }),
    onSettled: refresh,
  });

  const timeFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: profile?.timezone,
  });
  // A drafter may only touch drafts; anything live or scheduled belongs to a publisher.
  const mayChange = (post: Post) => canManage && (post.status === 'draft' || canPublish);
  const error = posts.error ?? unpublish.error ?? remove.error;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="News"
        description="Announcements, news and stories for the website. Write a draft, then someone who can publish puts it live now or at a set time."
        action={
          canManage && editing === null && !publishing ? (
            <Button onClick={() => setEditing('new')}>New post</Button>
          ) : null
        }
      />
      {editing !== null ? (
        <PostForm
          key={editing === 'new' ? 'new' : editing.id}
          editing={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}
      {publishing ? (
        <PublishPanel key={publishing.id} post={publishing} onDone={() => setPublishing(null)} />
      ) : null}

      <div className="max-w-xs">
        <SelectField label="Show" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All posts</option>
          <option value="draft">Drafts</option>
          <option value="scheduled">Scheduled</option>
          <option value="published">Published</option>
        </SelectField>
      </div>

      {error ? <Alert tone="error">{errorMessage(error)}</Alert> : null}
      <SimpleTable
        head={['Post', 'Status', '']}
        empty={!posts.isPending && rows.length === 0 ? 'Nothing here yet.' : null}
      >
        {rows.map((post) => (
          <tr key={post.id}>
            <td className="px-4 py-3">
              <div className="font-medium">{post.title}</div>
              <div className="text-muted-foreground text-xs">{KIND_LABELS[post.kind]}</div>
            </td>
            <td className="px-4 py-3">
              <Badge tone={STATUS_TONE[post.status]}>
                {post.status === 'draft'
                  ? 'Draft'
                  : post.status === 'scheduled'
                    ? 'Scheduled'
                    : 'Published'}
              </Badge>
              {post.publishAt ? (
                <div className="text-muted-foreground mt-1 text-xs">
                  {timeFormat.format(new Date(post.publishAt))}
                </div>
              ) : null}
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              {mayChange(post) ? (
                <Button variant="ghost" className="h-8 px-3" onClick={() => setEditing(post)}>
                  Edit
                </Button>
              ) : null}
              {canPublish && post.status === 'draft' ? (
                <Button variant="ghost" className="h-8 px-3" onClick={() => setPublishing(post)}>
                  Publish
                </Button>
              ) : null}
              {canPublish && post.status !== 'draft' ? (
                <Button
                  variant="ghost"
                  className="h-8 px-3"
                  disabled={unpublish.isPending}
                  onClick={() => unpublish.mutate(post)}
                >
                  Unpublish
                </Button>
              ) : null}
              {mayChange(post) ? (
                <Button
                  variant="ghost"
                  className="h-8 px-3"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete “${post.title}”? This can't be undone.`)) {
                      remove.mutate(post);
                    }
                  }}
                >
                  Delete
                </Button>
              ) : null}
            </td>
          </tr>
        ))}
      </SimpleTable>
      {posts.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={posts.isFetchingNextPage}
          onClick={() => void posts.fetchNextPage()}
        >
          {posts.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}
