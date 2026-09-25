'use client';

import {
  createRoomRequestSchema,
  ROOM_TYPES,
  type Room,
  type RoomType,
  roomSchema,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import { Button } from '@emis/ui/components/button';
import { Card, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { SelectField } from '@emis/ui/components/select';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { SectionHeader } from '@/components/section-header';
import { SimpleTable } from '@/components/simple-table';
import { useInstitution } from '@/features/institution/use-institution';
import { useBranches } from '@/features/institution/use-org-units';
import { useSession } from '@/features/session/use-session';
import { apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

import { useRooms } from './use-catalog';

const TYPE_LABELS: Record<RoomType, string> = {
  classroom: 'Classroom',
  lab: 'Lab',
  studio: 'Studio',
};

/** Features are typed comma-separated and sent as a list. */
const formSchema = createRoomRequestSchema
  .omit({ features: true })
  .extend({ features: z.string().max(400) });
type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

const toFeatures = (text: string) =>
  text
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);

function RoomForm({ editing, onDone }: { editing: Room | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const branches = useBranches();
  const idempotency = useIdempotencyKey();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      branchId: editing?.branchId ?? '',
      code: editing?.code ?? '',
      name: editing?.name ?? '',
      type: editing?.type ?? 'classroom',
      capacity: editing?.capacity ?? 20,
      features: editing?.features.join(', ') ?? '',
    },
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: ({ branchId, code, features, ...rest }: FormOutput) => {
      const list = toFeatures(features);
      return editing
        ? apiRequest(`/rooms/${editing.id}`, {
            method: 'PATCH',
            body: { ...rest, features: list },
            schema: roomSchema,
            ifMatch: editing.version,
          })
        : (() => {
            const body = { branchId, code, ...rest, features: list };
            return apiRequest('/rooms', {
              method: 'POST',
              body,
              schema: roomSchema,
              idempotencyKey: idempotency.keyFor(body),
            });
          })();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['rooms'] });
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {editing ? `Edit ${editing.name}` : 'Add a room'}
        </CardTitle>
      </CardHeader>
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
      >
        <SelectField
          label={term('branch')}
          disabled={editing !== null}
          error={errors.branchId?.message}
          {...form.register('branchId')}
        >
          <option value="">Choose…</option>
          {branches.data?.items
            .filter((b) => b.isActive || b.id === editing?.branchId)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
        </SelectField>
        <SelectField label="Type" error={errors.type?.message} {...form.register('type')}>
          {ROOM_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type]}
            </option>
          ))}
        </SelectField>
        <Field
          label="Code"
          readOnly={editing !== null}
          hint={editing ? 'Fixed once created.' : 'e.g. LAB1.'}
          error={errors.code?.message}
          {...form.register('code')}
        />
        <Field label="Name" error={errors.name?.message} {...form.register('name')} />
        <Field
          label="Seats"
          type="number"
          hint="Classes can't enroll more students than this."
          error={errors.capacity?.message}
          {...form.register('capacity', { valueAsNumber: true })}
        />
        <Field
          label="Features (optional)"
          placeholder="projector, air conditioning"
          hint="Separate with commas."
          error={errors.features?.message}
          {...form.register('features')}
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

export function RoomsScreen() {
  const queryClient = useQueryClient();
  const { term } = useInstitution();
  const { can } = useSession();
  const branches = useBranches();
  const [branchId, setBranchId] = useState('');
  const rooms = useRooms(branchId || undefined);
  const [editing, setEditing] = useState<Room | 'new' | null>(null);
  const canManage = can('facilities.manage');
  const rows = rooms.data?.items ?? [];

  const toggle = useMutation({
    mutationFn: (room: Room) =>
      apiRequest(`/rooms/${room.id}`, {
        method: 'PATCH',
        body: { isActive: !room.isActive },
        schema: roomSchema,
        ifMatch: room.version,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['rooms'] }),
  });

  const branchName = (id: string) => branches.data?.items.find((b) => b.id === id)?.name ?? '—';

  return (
    <>
      <SectionHeader
        title="Rooms"
        description="Classrooms and labs at each branch. A class can hold at most as many students as its room has seats."
        action={
          canManage && editing === null ? (
            <Button onClick={() => setEditing('new')}>Add room</Button>
          ) : null
        }
      />
      {editing !== null ? (
        <RoomForm
          key={editing === 'new' ? 'new' : editing.id}
          editing={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}
      <SelectField
        label={`Show ${term('branch').toLowerCase()}`}
        className="max-w-xs"
        value={branchId}
        onChange={(event) => setBranchId(event.target.value)}
      >
        <option value="">All</option>
        {branches.data?.items.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </SelectField>
      {toggle.error ? <Alert tone="error">{errorMessage(toggle.error)}</Alert> : null}
      {rooms.error ? <Alert tone="error">{errorMessage(rooms.error)}</Alert> : null}
      <SimpleTable
        head={['Room', term('branch'), 'Type', 'Seats', 'Status', '']}
        empty={!rooms.isPending && rows.length === 0 ? 'None yet.' : null}
      >
        {rows.map((room) => (
          <tr key={room.id}>
            <td className="px-4 py-3">
              <div className="font-medium">{room.name}</div>
              <div className="text-muted-foreground text-xs">
                <span className="font-mono">{room.code}</span>
                {room.features.length > 0 ? ` · ${room.features.join(', ')}` : ''}
              </div>
            </td>
            <td className="px-4 py-3">{branchName(room.branchId)}</td>
            <td className="px-4 py-3">{TYPE_LABELS[room.type]}</td>
            <td className="px-4 py-3">{room.capacity}</td>
            <td className="px-4 py-3">
              <Badge tone={room.isActive ? 'success' : 'neutral'}>
                {room.isActive ? 'In use' : 'Retired'}
              </Badge>
            </td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              {canManage ? (
                <>
                  <Button variant="ghost" className="h-8 px-3" onClick={() => setEditing(room)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-8 px-3"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate(room)}
                  >
                    {room.isActive ? 'Retire' : 'Restore'}
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
