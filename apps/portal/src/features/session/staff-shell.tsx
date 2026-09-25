'use client';

import type { Permission } from '@emis/permissions';
import { Alert } from '@emis/ui/components/alert';
import { Button } from '@emis/ui/components/button';
import { cn } from '@emis/ui/lib/cn';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';

import { useInstitution } from '@/features/institution/use-institution';
import { ApiError, apiRequest, errorMessage } from '@/lib/api';
import { pathForNextStep } from '@/lib/redirects';

import { useSession } from './use-session';

const NAV: { href: string; label: string; permission?: Permission }[] = [
  { href: '/', label: 'Home' },
  { href: '/academics', label: 'Academics', permission: 'catalog.read' },
  { href: '/users', label: 'Staff', permission: 'users.read' },
  { href: '/settings', label: 'Settings', permission: 'settings.manage' },
  { href: '/audit', label: 'Audit log', permission: 'audit.read' },
];

const isCurrent = (pathname: string, href: string) =>
  pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));

export function StaffShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { me, error, loading, can } = useSession();
  const { profile } = useInstitution();
  const needsSetup = profile?.setupCompleted === false;
  const canSetUp = can('settings.manage');

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace('/login');
    else if (me && me.nextStep !== 'none') router.replace(pathForNextStep(me.nextStep, pathname));
    else if (!loading && needsSetup && canSetUp && pathname !== '/setup') router.replace('/setup');
  }, [error, me, loading, needsSetup, canSetUp, pathname, router]);

  async function signOut() {
    await apiRequest('/auth/logout', { method: 'POST' }).catch(() => undefined);
    queryClient.clear();
    router.replace('/login');
  }

  if (error && !(error instanceof ApiError && error.status === 401)) {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <Alert tone="error">{errorMessage(error)}</Alert>
      </main>
    );
  }
  if (loading || !me || me.nextStep !== 'none') return null;

  return (
    <div className="min-h-dvh">
      <header className="border-border border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link href="/" className="text-sm font-semibold tracking-wide">
            {profile?.shortName ?? 'EMIS'}
          </Link>
          <nav className="flex gap-1 text-sm" aria-label="Main">
            {NAV.filter((item) => !item.permission || can(item.permission)).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
                className={cn(
                  'text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5',
                  isCurrent(pathname, item.href) && 'bg-muted text-foreground font-medium',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted-foreground hidden sm:inline">{me.user.displayName}</span>
            <Button variant="ghost" className="h-8 px-3" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        {needsSetup && !canSetUp ? (
          <Alert>An admin still needs to finish setting up {profile?.name}.</Alert>
        ) : null}
        {children}
      </main>
    </div>
  );
}
