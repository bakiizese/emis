'use client';

import {
  recoveryCodesResponseSchema,
  totpCodeSchema,
  type TotpSetupResponse,
  totpSetupResponseSchema,
} from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@emis/ui/components/card';
import { Field } from '@emis/ui/components/field';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { ApiError, apiRequest, errorMessage } from '@/lib/api';
import { safeNextPath } from '@/lib/redirects';

type Step =
  | { name: 'intro' }
  | { name: 'scan'; setup: TotpSetupResponse }
  | { name: 'codes'; codes: string[] };

/** Split the base32 secret into groups of four so it's easy to type into an app. */
const groupSecret = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

export function SetupMfaFlow() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get('next'));
  const [step, setStep] = useState<Step>({ name: 'intro' });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  function handle(e: unknown) {
    if (e instanceof ApiError && e.code === 'UNAUTHENTICATED') {
      router.replace('/login');
      return;
    }
    setError(errorMessage(e));
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const setup = await apiRequest('/auth/mfa/totp/setup', {
        method: 'POST',
        schema: totpSetupResponseSchema,
      });
      setStep({ name: 'scan', setup });
    } catch (e) {
      handle(e);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    const parsed = totpCodeSchema.safeParse(code);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter the 6-digit code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { recoveryCodes } = await apiRequest('/auth/mfa/totp/confirm', {
        method: 'POST',
        body: { code: parsed.data },
        schema: recoveryCodesResponseSchema,
      });
      setStep({ name: 'codes', codes: recoveryCodes });
    } catch (e) {
      handle(e);
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  function download(codes: string[]) {
    const blob = new Blob([`EMIS recovery codes\nEach code works once.\n\n${codes.join('\n')}\n`], {
      type: 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: 'emis-recovery-codes.txt',
    });
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up two-factor authentication</CardTitle>
        <CardDescription>
          {step.name === 'codes'
            ? 'Save these recovery codes somewhere safe. Each one works once if you lose your phone.'
            : 'Your account needs a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) at every sign-in.'}
        </CardDescription>
      </CardHeader>

      <div className="space-y-4">
        {error ? <Alert tone="error">{error}</Alert> : null}

        {step.name === 'intro' ? (
          <Button className="w-full" onClick={() => void start()} disabled={busy}>
            {busy ? 'Preparing…' : 'Show QR code'}
          </Button>
        ) : null}

        {step.name === 'scan' ? (
          <form className="space-y-4" onSubmit={(event) => void confirm(event)} noValidate>
            <div className="flex justify-center rounded-lg bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- data URI from our API; img keeps SVG inert */}
              <img
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(step.setup.qrCodeSvg)}`}
                alt="QR code for your authenticator app"
                width={184}
                height={184}
              />
            </div>
            <div className="text-muted-foreground space-y-1 text-sm">
              <p>Can&apos;t scan it? Enter this key instead:</p>
              <code className="bg-muted text-foreground block rounded px-2 py-1.5 font-mono text-xs tracking-wide">
                {groupSecret(step.setup.secret)}
              </code>
            </div>
            <Field
              label="6-digit code from the app"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
            />
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Checking…' : 'Turn on two-factor authentication'}
            </Button>
          </form>
        ) : null}

        {step.name === 'codes' ? (
          <>
            <ol className="bg-muted grid grid-cols-2 gap-2 rounded-lg p-4 font-mono text-sm">
              {step.codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ol>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => void navigator.clipboard.writeText(step.codes.join('\n'))}
              >
                Copy
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => download(step.codes)}>
                Download
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={saved}
                onChange={(event) => setSaved(event.target.checked)}
              />
              I&apos;ve saved my recovery codes
            </label>
            <Button className="w-full" disabled={!saved} onClick={() => router.replace(next)}>
              Continue
            </Button>
          </>
        ) : null}
      </div>
    </Card>
  );
}
