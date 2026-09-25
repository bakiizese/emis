'use client';

import { type Intake, intakeSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { SelectField } from '@emis/ui/components/select';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { SectionHeader } from '@/components/section-header';
import { SimpleTable } from '@/components/simple-table';
import { useInstitution } from '@/features/institution/use-institution';
import { useSession } from '@/features/session/use-session';
import { apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

import {
  formatDate,
  formatDateTime,
  fromLocalInput,
  toLocalInput,
  useIntakes,
  usePrograms,
} from './use-catalog';

function IntakeForm({ editing, onDone }: { editing: Intake | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const programs = usePrograms();
  const idempotency = useIdempotencyKey();
  const [programId, setProgramId] = useState(editing?.programId ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const [startDate, setStartDate] = useState(editing?.startDate ?? '');
  const [opens, setOpens] = useState(toLocalInput(editing?.registrationOpensAt ?? null));
  const [closes, setCloses] = useState(toLocalInput(editing?.registrationClosesAt ?? null));

  const save = useMutation({
    mutationFn: () => {
      const window = {
        registrationOpensAt: fromLocalInput(opens),
        registrationClosesAt: fromLocalInput(closes),
      };
      return editing
        ? apiRequest(`/intakes/${editing.id}`, {
            method: 'PATCH',
            body: { name, startDate, ...window },
            schema: intakeSchema,
            ifMatch: editing.version,
          })
        : (() => {
            const body = { programId: programId || null, name, startDate, ...window };
            return apiRequest('/intakes', {
              method: 'POST',
              body,
              schema: intakeSchema,
              idempotencyKey: idempotency.keyFor(body),
            });
          })();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['intakes'] });
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {editing ? `Edit ${editing.name}` : `Add an ${term('intake').toLowerCase()}`}
        </CardTitle>
      </CardHeader>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Field
          label="Name"
          placeholder="e.g. September 2026"
          value={name}
          required
          minLength={2}
          onChange={(event) => setName(event.target.value)}
        />
        <SelectField
          label={term('program')}
          disabled={editing !== null}
          value={programId}
          onChange={(event) => setProgramId(event.target.value)}
        >
          <option value="">Any {term('program').toLowerCase()}</option>
          {programs.data?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <Field
          label="Classes start"
          type="date"
          value={startDate}
          required
          onChange={(event) => setStartDate(event.target.value)}
        />
        <div />
        <Field
          label="Registration opens (optional)"
          type="datetime-local"
          value={opens}
          onChange={(event) => setOpens(event.target.value)}
        />
        <Field
          label="Registration closes (optional)"
          type="datetime-local"
          value={closes}
          onChange={(event) => setCloses(event.target.value)}
        />
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

export function IntakesScreen() {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const { can } = useSession();
  const intakes = useIntakes();
  const programs = usePrograms();
  const [editing, setEditing] = useState<Intake | 'new' | null>(null);
  const canManage = can('calendar.manage');
  const rows = intakes.data?.items ?? [];

  const toggle = useMutation({
    mutationFn: (intake: Intake) =>
      apiRequest(`/intakes/${intake.id}`, {
        method: 'PATCH',
        body: { isActive: !intake.isActive },
        schema: intakeSchema,
        ifMatch: intake.version,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['intakes'] }),
  });

  const programName = (id: string | null) =>
    id
      ? (programs.data?.items.find((p) => p.id === id)?.name ?? '—')
      : `Any ${term('program').toLowerCase()}`;

  return (
    <>
      <SectionHeader
        title={term('intake', true)}
        description="When new classes start and when registration is open for them."
        action={
          canManage && editing === null ? (
            <Button onClick={() => setEditing('new')}>Add {term('intake').toLowerCase()}</Button>
          ) : null
        }
      />
      {editing !== null ? (
        <IntakeForm
          key={editing === 'new' ? 'new' : editing.id}
          editing={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}
      {toggle.error ? <Alert tone="error">{errorMessage(toggle.error)}</Alert> : null}
      {intakes.error ? <Alert tone="error">{errorMessage(intakes.error)}</Alert> : null}
      <SimpleTable
        head={[term('intake'), term('program'), 'Classes start', 'Registration', 'Status', '']}
        empty={!intakes.isPending && rows.length === 0 ? 'None yet.' : null}
      >
        {rows.map((intake) => (
          <tr key={intake.id}>
            <td className="px-4 py-3 font-medium">{intake.name}</td>
            <td className="px-4 py-3">{programName(intake.programId)}</td>
            <td className="px-4 py-3">{formatDate(intake.startDate)}</td>
            <td className="text-muted-foreground px-4 py-3">
              {intake.registrationOpensAt || intake.registrationClosesAt
                ? `${formatDateTime(intake.registrationOpensAt)} → ${formatDateTime(intake.registrationClosesAt)}`
                : 'Always open'}
            </td>
            <td className="px-4 py-3">
              <Badge tone={intake.isActive ? 'success' : 'neutral'}>
                {intake.isActive ? 'Active' : 'Closed'}
              </Badge>
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              {canManage ? (
                <>
                  <Button variant="ghost" className="h-8 px-3" onClick={() => setEditing(intake)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-8 px-3"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate(intake)}
                  >
                    {intake.isActive ? 'Close' : 'Reopen'}
                  </Button>
                </>
              ) : null}
            </td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}
