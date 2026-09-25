import type { ReactNode } from 'react';

import { InstitutionName } from '@/features/institution/institution-name';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <InstitutionName className="text-muted-foreground text-center text-sm font-medium tracking-wide uppercase" />
        {children}
      </div>
    </main>
  );
}
