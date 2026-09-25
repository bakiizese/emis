'use client';

import {
  inviteStaffRequestSchema,
  roleListResponseSchema,
  type ScopeInput,
  staffUserSchema,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { SelectField } from '@emis/ui/components/select';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { useInstitution } from '@/features/institution/use-institution';
import { useBranches, useDepartments } from '@/features/institution/use-org-units';
import { ApiError, apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

// Where the role applies, as one select value: "global", "branch:<id>" or "department:<id>".
const formSchema = inviteStaffRequestSchema
  .omit({ scope: true })
  .extend({ where: z.string().min(1, 'Choose where the role applies') });
type FormValues = z.input<typeof formSchema>;

function toScope(where: string): ScopeInput {
  const [type, id] = where.split(':');
  if ((type === 'branch' || type === 'department') && id) return { type, id };
  return { type: 'global' };
}

export function InviteForm({ onDone }: { onDone: (email: string) => void }) {
  const queryClient = useQueryClient();
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => apiRequest('/roles', { schema: roleListResponseSchema }),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '', displayName: '', roleKey: 'secretary', where: 'global' },
  });
  const { errors } = form.formState;
  const { term } = useInstitution();
  const branches = useBranches();
  const departments = useDepartments();

  const idempotency = useIdempotencyKey();
  const invite = useMutation({
    mutationFn: ({ where, ...values }: FormValues) => {
      const body = { ...values, scope: toScope(where) };
      return apiRequest('/users/invitations', {
        method: 'POST',
        body,
        schema: staffUserSchema,
        idempotencyKey: idempotency.keyFor(body),
      });
    },
    onSuccess: async (user) => {
      idempotency.reset();
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      form.reset();
      onDone(user.email);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'EMAIL_TAKEN')
        form.setError('email', { message: error.message });
    },
  });

  const roleKey = useWatch({ control: form.control, name: 'roleKey' });
  const selected = roles.data?.items.find((r) => r.key === roleKey);
  const allowed = selected?.allowedScopes ?? ['global'];
  const places = [
    ...(allowed.includes('global') ? [{ value: 'global', label: 'Whole institution' }] : []),
    ...(allowed.includes('branch')
      ? (branches.data?.items ?? [])
          .filter((b) => b.isActive)
          .map((b) => ({ value: `branch:${b.id}`, label: `${term('branch')}: ${b.name}` }))
      : []),
    ...(allowed.includes('department')
      ? (departments.data?.items ?? [])
          .filter((d) => d.isActive)
          .map((d) => ({ value: `department:${d.id}`, label: `${term('department')}: ${d.name}` }))
      : []),
  ];

  // A role that can't be limited (e.g. Admin) resets the choice to the whole institution.
  const { setValue, getValues } = form;
  const placeValues = places.map((p) => p.value).join('|');
  useEffect(() => {
    const values = placeValues.split('|');
    if (!values.includes(getValues('where'))) setValue('where', values[0] ?? 'global');
  }, [placeValues, getValues, setValue]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invite a staff member</CardTitle>
        <CardDescription>
          They get an email with a link to choose their password. It expires in 72 hours.
        </CardDescription>
      </CardHeader>
      <form
        className="grid gap-4 sm:grid-cols-3"
        onSubmit={(event) => void form.handleSubmit((values) => invite.mutate(values))(event)}
        noValidate
      >
        {invite.error &&
        !(invite.error instanceof ApiError && invite.error.code === 'EMAIL_TAKEN') ? (
          <Alert tone="error" className="sm:col-span-3">
            {errorMessage(invite.error)}
          </Alert>
        ) : null}
        <Field
          label="Full name"
          autoComplete="off"
          error={errors.displayName?.message}
          {...form.register('displayName')}
        />
        <Field
          label="Email"
          type="email"
          autoComplete="off"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <SelectField label="Role" error={errors.roleKey?.message} {...form.register('roleKey')}>
          {roles.data?.items.map((role) => (
            <option key={role.key} value={role.key}>
              {role.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Where" error={errors.where?.message} {...form.register('where')}>
          {places.map((place) => (
            <option key={place.value} value={place.value}>
              {place.label}
            </option>
          ))}
        </SelectField>
        <p className="text-muted-foreground self-end text-sm sm:col-span-2">
          {selected?.description}
          {selected?.mfaRequired ? ' Requires two-factor authentication.' : ''}
        </p>
        <div className="flex justify-end sm:col-span-3">
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? 'Sending…' : 'Send invitation'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
