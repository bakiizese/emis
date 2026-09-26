import { cn } from '@emis/ui/lib/cn';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** One headline number. With `href` the whole tile is a link to the screen behind it. */
export function Stat({
  label,
  value,
  hint,
  href,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  href?: string;
  tone?: 'default' | 'attention';
}) {
  const body = (
    <>
      <p className="text-muted-foreground text-sm">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tracking-tight',
          tone === 'attention' && 'text-amber-700 dark:text-amber-300',
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
    </>
  );
  const classes = 'border-border bg-background rounded-xl border p-4';
  return href ? (
    <Link href={href} className={cn(classes, 'hover:border-primary transition-colors')}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

export function Bar({ percent }: { percent: number }) {
  return (
    <div className="bg-muted h-2 rounded-full" aria-hidden="true">
      <div className="bg-primary h-2 rounded-full" style={{ width: `${percent}%` }} />
    </div>
  );
}
