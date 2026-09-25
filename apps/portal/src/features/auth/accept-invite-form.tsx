'use client';

import { invitationDetailsSchema, newPasswordSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError, apiRequest, errorMessage } from '@/lib/api';

// Same approach as the reset link: token in the fragment, read once, then wiped from the URL.
let capturedToken: string | null | undefined;
function readTokenOnce(): string | null {
  if (capturedToken === undefined) {
    capturedToken = new URLSearchParams(window.location.hash.slice(1)).get('token');
    window.history.replaceState(null, '', window.location.pathname);
  }
  return capturedToken;
}
const noSubscription = () => () => undefined;

const schema = z
  .object({ password: newPasswordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: "Passwords don't match" });

export function AcceptInviteForm() {
  const router = useRouter();
  const token = useSyncExternalStore(noSubscription, readTokenOnce, () => undefined);

  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: () =>
      apiRequest('/invitations/inspect', {
        method: 'POST',
        body: { token },
        schema: invitationDetailsSchema,
      }),
    enabled: Boolean(token),
  });

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });
  const { errors } = form.formState;

  const accept = useMutation({
    mutationFn: (password: string) =>
      apiRequest('/invitations/accept', { method: 'POST', body: { token, password } }),
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'WEAK_PASSWORD')
        form.setError('password', { message: error.message });
    },
  });

  if (token === undefined) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up your account</CardTitle>
        <CardDescription>
          {invitation.data
            ? `Welcome, ${invitation.data.displayName}. Choose a password for ${invitation.data.email}.`
            : 'Choose a password to activate your staff account.'}
        </CardDescription>
      </CardHeader>

      {!token || invitation.error ? (
        <Alert tone="error">
          {invitation.error
            ? errorMessage(invitation.error)
            : 'This invitation link is incomplete.'}{' '}
          Ask an admin to send a new invitation.
        </Alert>
      ) : accept.isSuccess ? (
        <div className="space-y-4">
          <Alert tone="success">
            Your account is ready. Sign in with your email and new password.
          </Alert>
          <Button className="w-full" onClick={() => router.push('/login')}>
            Sign in
          </Button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) =>
            void form.handleSubmit((values) => accept.mutate(values.password))(event)
          }
          noValidate
        >
          {accept.error &&
          !(accept.error instanceof ApiError && accept.error.code === 'WEAK_PASSWORD') ? (
            <Alert tone="error">{errorMessage(accept.error)}</Alert>
          ) : null}
          <input
            type="email"
            autoComplete="username"
            value={invitation.data?.email ?? ''}
            readOnly
            hidden
          />
          <Field
            label="Password"
            type="password"
            autoComplete="new-password"
            hint="At least 12 characters. A few unrelated words work well."
            error={errors.password?.message}
            {...form.register('password')}
          />
          <Field
            label="Repeat password"
            type="password"
            autoComplete="new-password"
            error={errors.confirm?.message}
            {...form.register('confirm')}
          />
          <Button type="submit" className="w-full" disabled={accept.isPending || !invitation.data}>
            {accept.isPending ? 'Saving…' : 'Activate account'}
          </Button>
        </form>
      )}
    </Card>
  );
}
