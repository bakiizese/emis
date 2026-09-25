'use client';

import { newPasswordSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError, apiRequest, errorMessage } from '@/lib/api';

// The token travels in the URL fragment, which browsers never send to servers. Read it once,
// then drop it from the address bar and history.
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

export function ResetPasswordForm() {
  const router = useRouter();
  // undefined while server-rendering; the real value once hydrated in the browser.
  const token = useSyncExternalStore(noSubscription, readTokenOnce, () => undefined);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    if (!token) return;
    setError(null);
    try {
      await apiRequest('/auth/password/reset', {
        method: 'POST',
        body: { token, password: values.password },
      });
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'WEAK_PASSWORD') {
        form.setError('password', { message: e.message });
        return;
      }
      setError(errorMessage(e));
    }
  });

  if (token === undefined) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>At least 12 characters. A few unrelated words work well.</CardDescription>
      </CardHeader>
      {done ? (
        <div className="space-y-4">
          <Alert tone="success">
            Your password is updated and you were signed out of other devices.
          </Alert>
          <Button className="w-full" onClick={() => router.push('/login')}>
            Sign in
          </Button>
        </div>
      ) : !token ? (
        <div className="space-y-4">
          <Alert tone="error">This reset link is incomplete. Request a new one.</Alert>
          <Link
            href="/forgot-password"
            className="text-muted-foreground block text-center text-sm hover:underline"
          >
            Request a new link
          </Link>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(event) => void onSubmit(event)} noValidate>
          {error ? (
            <Alert tone="error">
              {error}{' '}
              <Link href="/forgot-password" className="underline">
                Request a new link
              </Link>
            </Alert>
          ) : null}
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            autoFocus
            error={errors.password?.message}
            {...form.register('password')}
          />
          <Field
            label="Repeat new password"
            type="password"
            autoComplete="new-password"
            error={errors.confirm?.message}
            {...form.register('confirm')}
          />
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save password'}
          </Button>
        </form>
      )}
    </Card>
  );
}
