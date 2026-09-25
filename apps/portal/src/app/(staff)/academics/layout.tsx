import type { ReactNode } from 'react';

import { AcademicsNav } from '@/features/academics/academics-nav';

export default function AcademicsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Academics</h1>
      <div className="grid gap-6 md:grid-cols-[12rem_1fr]">
        <AcademicsNav />
        <div className="min-w-0 space-y-6">{children}</div>
      </div>
    </div>
  );
}
