'use client';

import { type Approval, approvalSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Card } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { SectionHeader } from '@/components/section-header';
import { useSession } from '@/features/session/use-session';
import { apiRequest, errorMessage } from '@/lib/api';

import { useApprovals } from './use-billing';

const statusTone = { pending: 'warning', approved: 'success', rejected: 'neutral' } as const;
const typeLabel = { discount: 'Discount', payment_void: 'Void a payment' } as const;

function ApprovalCard({
  approval,
  canDecide,
  myId,
}: {
  approval: Approval;
  canDecide: boolean;
  myId: string;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const mine = approval.requestedBy.id === myId;

  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      apiRequest(`/approvals/${approval.id}/decision`, {
        method: 'POST',
        body: { decision, note },
        schema: approvalSchema,
      }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['approvals'] });
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      await queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
  });

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge tone="info">{typeLabel[approval.type]}</Badge>
            <Badge tone={statusTone[approval.status]}>
              {approval.status.charAt(0).toUpperCase() + approval.status.slice(1)}
            </Badge>
          </div>
          <p className="font-medium">{approval.summary}</p>
          <p className="text-muted-foreground text-sm">Reason: {approval.reason}</p>
        </div>
        <p className="text-muted-foreground text-right text-xs">
          Asked by {mine ? 'you' : approval.requestedBy.name}
          <br />
          {new Date(approval.createdAt).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </p>
      </div>

      {approval.status !== 'pending' ? (
        <p className="text-muted-foreground text-sm">
          {approval.status === 'approved' ? 'Approved' : 'Rejected'} by {approval.decidedBy?.name}
          {approval.decidedAt ? ` on ${new Date(approval.decidedAt).toLocaleDateString()}` : ''}
          {approval.decisionNote ? `: ${approval.decisionNote}` : ''}
        </p>
      ) : canDecide && !mine ? (
        <div className="space-y-3">
          <Field label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          {decide.error ? <Alert tone="error">{errorMessage(decide.error)}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={decide.isPending}
              onClick={() => decide.mutate('reject')}
            >
              Reject
            </Button>
            <Button disabled={decide.isPending} onClick={() => decide.mutate('approve')}>
              {decide.isPending ? 'Working…' : 'Approve'}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          {mine
            ? "Waiting for someone else to decide. You can't approve your own request."
            : 'Waiting for an approver.'}
        </p>
      )}
    </Card>
  );
}

export function ApprovalsScreen() {
  const { can, me } = useSession();
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const approvals = useApprovals(tab);
  const canDecide = can('approvals.decide');
  const items = approvals.data?.items ?? [];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Approvals"
        description={
          canDecide
            ? 'Discounts and voided payments wait here until someone other than the requester approves them.'
            : 'Your requests for discounts and voided payments, and where each one stands.'
        }
      />
      <div className="flex gap-2">
        <Button
          variant={tab === 'pending' ? 'primary' : 'secondary'}
          onClick={() => setTab('pending')}
        >
          Waiting
        </Button>
        <Button
          variant={tab === 'history' ? 'primary' : 'secondary'}
          onClick={() => setTab('history')}
        >
          Decided
        </Button>
      </div>
      {approvals.error ? <Alert tone="error">{errorMessage(approvals.error)}</Alert> : null}
      {!approvals.isPending && items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {tab === 'pending' ? 'Nothing is waiting.' : 'Nothing decided yet.'}
        </p>
      ) : null}
      <div className="space-y-4">
        {items.map((approval) => (
          <ApprovalCard
            key={`${approval.id}:${approval.version}`}
            approval={approval}
            canDecide={canDecide}
            myId={me?.user.id ?? ''}
          />
        ))}
      </div>
    </div>
  );
}
