'use client';

import { type MeResponse, meResponseSchema } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@emis/ui/components/card';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ApiError, apiRequest, errorMessage } from '@/lib/api';
import { pathForNextStep } from '@/lib/redirects';

/** Placeholder home until the dashboard shell lands: who you are, and a way out. */
export function AccountSummary() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest('/auth/me', { schema: meResponseSchema })
      .then((data) => {
        if (data.nextStep !== 'none') router.replace(pathForNextStep(data.nextStep, '/'));
        else setMe(data);
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) router.replace('/login');
        else setError(errorMessage(e));
      });
  }, [router]);

  async function signOut() {
    await apiRequest('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
  }

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!me) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome, {me.user.displayName}</CardTitle>
        <CardDescription>{me.user.email}</CardDescription>
      </CardHeader>
      <div className="space-y-4 text-sm">
        <p>
          Two-factor authentication:{' '}
          <strong>{me.user.mfaEnabled ? 'on' : me.user.mfaEnforced ? 'required' : 'off'}</strong>
        </p>
        <Button variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </Card>
  );
}
