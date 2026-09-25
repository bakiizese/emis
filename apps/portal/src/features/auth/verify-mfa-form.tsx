'use client';

import { recoveryCodeSchema, totpCodeSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { ApiError, apiRequest, errorMessage } from '@/lib/api';
import { safeNextPath } from '@/lib/redirects';

export function VerifyMfaForm() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get('next'));
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = (useRecovery ? recoveryCodeSchema : totpCodeSchema).safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the code and try again.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await apiRequest('/auth/mfa/verify', {
        method: 'POST',
        body: useRecovery ? { recoveryCode: parsed.data } : { code: parsed.data },
      });
      router.replace(next);
    } catch (e) {
      // Too many wrong codes ends the pending session: start over.
      if (e instanceof ApiError && e.code === 'UNAUTHENTICATED') {
        router.replace('/login');
        return;
      }
      setError(errorMessage(e));
      setValue('');
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor authentication</CardTitle>
        <CardDescription>
          {useRecovery
            ? 'Enter one of the recovery codes you saved when you set up two-factor authentication.'
            : 'Enter the 6-digit code from your authenticator app.'}
        </CardDescription>
      </CardHeader>
      <form className="space-y-4" onSubmit={(event) => void onSubmit(event)} noValidate>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field
          key={useRecovery ? 'recovery' : 'totp'}
          label={useRecovery ? 'Recovery code' : 'Authentication code'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoFocus
          autoComplete="one-time-code"
          inputMode={useRecovery ? 'text' : 'numeric'}
          maxLength={useRecovery ? 32 : 6}
          placeholder={useRecovery ? 'XXXXX-XXXXX' : '123456'}
        />
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Checking…' : 'Verify'}
        </Button>
        <button
          type="button"
          className="text-muted-foreground w-full text-center text-sm underline-offset-4 hover:underline"
          onClick={() => {
            setUseRecovery(!useRecovery);
            setValue('');
            setError(null);
          }}
        >
          {useRecovery ? 'Use your authenticator app instead' : 'Use a recovery code instead'}
        </button>
      </form>
    </Card>
  );
}
