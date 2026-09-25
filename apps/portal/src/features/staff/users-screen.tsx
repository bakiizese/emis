'use client';

import { type StaffUser, staffListResponseSchema, staffUserSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Input } from '@emis/ui/components/input';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';

import { useScopeLabel } from '@/features/institution/use-org-units';
import { apiRequest, errorMessage } from '@/lib/api';

import { useSession } from '../session/use-session';
import { InviteForm } from './invite-form';

const statusTone = { active: 'success', invited: 'warning', disabled: 'danger' } as const;

function formatDate(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Never';
}

export function UsersScreen() {
  const { me, can } = useSession();
  const scopeLabel = useScopeLabel(can('settings.read'));
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const users = useInfiniteQuery({
    queryKey: ['users', q],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        limit: '25',
        ...(q ? { q } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      });
      return apiRequest(`/users?${params.toString()}`, { schema: staffListResponseSchema });
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

  const act = useMutation({
    mutationFn: async ({
      user,
      action,
    }: {
      user: StaffUser;
      action: 'disable' | 'enable' | 'resend';
    }) => {
      if (action === 'resend') {
        await apiRequest(`/users/${user.id}/invitation`, { method: 'POST' });
        return;
      }
      await apiRequest(`/users/${user.id}/status`, {
        method: 'PATCH',
        body: { status: action === 'disable' ? 'disabled' : 'active' },
        schema: staffUserSchema,
      });
    },
    onSuccess: async (_result, { user, action }) => {
      setNotice(
        action === 'resend'
          ? `New invitation sent to ${user.email}.`
          : `${user.displayName} is now ${action === 'disable' ? 'disabled and signed out everywhere' : 'active'}.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const rows = users.data?.pages.flatMap((page) => page.items) ?? [];
  const canManage = can('users.manage');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
        {can('users.invite') ? (
          <Button
            onClick={() => setInviting(!inviting)}
            variant={inviting ? 'secondary' : 'primary'}
          >
            {inviting ? 'Close' : 'Invite staff'}
          </Button>
        ) : null}
      </div>

      {inviting ? (
        <InviteForm
          onDone={(email) => {
            setInviting(false);
            setNotice(`Invitation sent to ${email}.`);
          }}
        />
      ) : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {act.error ? <Alert tone="error">{errorMessage(act.error)}</Alert> : null}
      {users.error ? <Alert tone="error">{errorMessage(users.error)}</Alert> : null}

      <Input
        type="search"
        placeholder="Search by name or email"
        aria-label="Search staff"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="max-w-sm"
      />

      <div className="border-border overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground text-xs uppercase">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Roles</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Last sign-in</th>
              {canManage ? <th className="sr-only px-4 py-3 font-medium">Actions</th> : null}
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.map((user) => (
              <tr key={user.id}>
                <td className="px-4 py-3">
                  <div className="font-medium">{user.displayName}</div>
                  <div className="text-muted-foreground">{user.email}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {user.roles.map((r) => (
                      <Badge key={r.id} tone="info" title={scopeLabel(r.scope)}>
                        {r.roleName}
                        {r.scope.type === 'global' ? null : ` · ${scopeLabel(r.scope)}`}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={statusTone[user.status]}>{user.status}</Badge>
                    {user.mfaEnabled ? <Badge>2FA</Badge> : null}
                  </div>
                </td>
                <td className="text-muted-foreground px-4 py-3">{formatDate(user.lastLoginAt)}</td>
                {canManage ? (
                  <td className="px-4 py-3 text-right">
                    {user.id === me?.user.id ? null : user.status === 'invited' ? (
                      <Button
                        variant="ghost"
                        className="h-8 px-3"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ user, action: 'resend' })}
                      >
                        Resend invite
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        className="h-8 px-3"
                        disabled={act.isPending}
                        onClick={() =>
                          act.mutate({
                            user,
                            action: user.status === 'disabled' ? 'enable' : 'disable',
                          })
                        }
                      >
                        {user.status === 'disabled' ? 'Enable' : 'Disable'}
                      </Button>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
            {!users.isPending && rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground px-4 py-8 text-center">
                  {q ? 'No staff match that search.' : 'No staff yet.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {users.hasNextPage ? (
        <Button
          variant="secondary"
          onClick={() => void users.fetchNextPage()}
          disabled={users.isFetchingNextPage}
        >
          {users.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}
