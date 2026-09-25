'use client';

import { inviteStaffRequestSchema, roleListResponseSchema, staffUserSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { SelectField } from '@emis/ui/components/select';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { ApiError, apiRequest, errorMessage } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';

// The form only offers the institution-wide scope until branches and departments exist.
const formSchema = inviteStaffRequestSchema.omit({ scope: true });
type FormValues = z.input<typeof formSchema>;

export function InviteForm({ onDone }: { onDone: (email: string) => void }) {
  const queryClient = useQueryClient();
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => apiRequest('/roles', { schema: roleListResponseSchema }),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '', displayName: '', roleKey: 'secretary' },
  });
  const { errors } = form.formState;

  const idempotency = useIdempotencyKey();
  const invite = useMutation({
    mutationFn: (values: FormValues) =>
      apiRequest('/users/invitations', {
        method: 'POST',
        body: values,
        schema: staffUserSchema,
        idempotencyKey: idempotency.keyFor(values),
      }),
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
        <p className="text-muted-foreground text-sm sm:col-span-2">
          {selected?.description}
          {selected?.mfaRequired ? ' Requires two-factor authentication.' : ''}
        </p>
        <div className="flex justify-end">
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? 'Sending…' : 'Send invitation'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
