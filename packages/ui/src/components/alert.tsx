import type { HTMLAttributes } from 'react';

import { cn } from '../lib/cn';

type AlertTone = 'error' | 'success' | 'info';

const tones: Record<AlertTone, string> = {
  error: 'border-red-600/30 bg-red-600/10 text-red-700 dark:text-red-300',
  success: 'border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-300',
  info: 'border-border bg-muted text-foreground',
};

export function Alert({
  className,
  tone = 'info',
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: AlertTone }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-md border px-3 py-2 text-sm', tones[tone], className)}
      {...props}
    />
  );
}
