import type { InputHTMLAttributes } from 'react';

import { cn } from '../lib/cn';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'border-border bg-background h-10 w-full rounded-md border px-3 text-sm',
        'placeholder:text-muted-foreground focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-600',
        className,
      )}
      {...props}
    />
  );
}
