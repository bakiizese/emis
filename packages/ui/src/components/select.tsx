import { type SelectHTMLAttributes, useId } from 'react';

import { cn } from '../lib/cn';
import { Label } from './label';

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
}

export function SelectField({ label, error, id, className, children, ...props }: SelectFieldProps) {
  const generated = useId();
  const selectId = id ?? generated;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={selectId}>{label}</Label>
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        className={cn(
          'border-border bg-background h-10 w-full rounded-md border px-3 text-sm',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none aria-invalid:border-red-600',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </div>
  );
}
