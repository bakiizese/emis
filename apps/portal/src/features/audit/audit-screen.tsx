'use client';

import { auditListResponseSchema, auditVerifyResponseSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';

import { apiRequest, errorMessage } from '@/lib/api';

function show(value: unknown): string {
  if (typeof value === 'string') return value;
  // Role scopes read better as words than as JSON.
  if (value !== null && typeof value === 'object' && 'type' in value) {
    const scope = value as { type: unknown; id?: unknown };
    if (scope.type === 'global') return 'institution-wide';
    if (typeof scope.type === 'string' && typeof scope.id === 'string')
      return `${scope.type} ${scope.id.slice(0, 8)}`;
  }
  return JSON.stringify(value) ?? '';
}

/** "status: active → disabled · sessionsRevoked: 2" */
function describe(changes: Record<string, unknown>): string {
  return Object.entries(changes)
    .map(([key, value]) =>
      value !== null && typeof value === 'object' && 'from' in value && 'to' in value
        ? `${key}: ${show(value.from)} → ${show(value.to)}`
        : `${key}: ${show(value)}`,
    )
    .join(' · ');
}

export function AuditScreen() {
  const log = useInfiniteQuery({
    queryKey: ['audit-log'],
    queryFn: ({ pageParam }) =>
      apiRequest(`/audit-log?limit=50${pageParam ? `&cursor=${pageParam}` : ''}`, {
        schema: auditListResponseSchema,
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const verify = useMutation({
    mutationFn: () => apiRequest('/audit-log/verify', { schema: auditVerifyResponseSchema }),
  });

  const rows = log.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
          <p className="text-muted-foreground text-sm">
            Every change to staff and roles. Entries can&apos;t be edited or deleted.
          </p>
        </div>
        <Button variant="secondary" onClick={() => verify.mutate()} disabled={verify.isPending}>
          {verify.isPending ? 'Checking…' : 'Verify integrity'}
        </Button>
      </div>

      {verify.data ? (
        verify.data.intact ? (
          <Alert tone="success">
            Intact: all {verify.data.checked} entries match their hash chain.
          </Alert>
        ) : (
          <Alert tone="error">
            Tampering detected at entry #{verify.data.brokenAtSeq}. That entry and everything after
            it can&apos;t be trusted.
          </Alert>
        )
      ) : null}
      {verify.error ? <Alert tone="error">{errorMessage(verify.error)}</Alert> : null}
      {log.error ? <Alert tone="error">{errorMessage(log.error)}</Alert> : null}

      <div className="border-border overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground text-xs uppercase">
            <tr>
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Who</th>
              <th className="px-4 py-3 font-medium">What</th>
              <th className="px-4 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.map((entry) => (
              <tr key={entry.id} className="align-top">
                <td className="text-muted-foreground px-4 py-3 tabular-nums">{entry.seq}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {new Date(entry.occurredAt).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'medium',
                  })}
                </td>
                <td className="px-4 py-3">
                  {entry.actorEmail ?? <span className="text-muted-foreground">system</span>}
                </td>
                <td className="px-4 py-3">
                  <Badge tone="info">{entry.action}</Badge>
                </td>
                <td className="text-muted-foreground px-4 py-3 break-words">
                  {describe(entry.changes)}
                </td>
              </tr>
            ))}
            {!log.isPending && rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground px-4 py-8 text-center">
                  Nothing recorded yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {log.hasNextPage ? (
        <Button
          variant="secondary"
          onClick={() => void log.fetchNextPage()}
          disabled={log.isFetchingNextPage}
        >
          {log.isFetchingNextPage ? 'Loading…' : 'Load older entries'}
        </Button>
      ) : null}
    </div>
  );
}
