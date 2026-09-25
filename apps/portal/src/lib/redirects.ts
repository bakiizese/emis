import type { AuthNextStep } from '@emis/contracts';

/** Only same-site paths: `?next=https://evil.example` must never become a redirect. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}

export function pathForNextStep(step: AuthNextStep, next: string): string {
  const query = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;
  if (step === 'mfa') return `/login/verify${query}`;
  if (step === 'mfa_enrollment') return `/login/setup-mfa${query}`;
  return next;
}
