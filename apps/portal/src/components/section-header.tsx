import type { ReactNode } from 'react';

/** Title + one line of explanation (+ an optional action button) at the top of a page section. */
export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground max-w-prose text-sm">{description}</p>
      </div>
      {action}
    </div>
  );
}
