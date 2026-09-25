import { type InputHTMLAttributes, type ReactNode, useId } from 'react';

import { cn } from '../lib/cn';

export interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
}

/** Checkbox with a label and an optional line of explanation under it. */
export function CheckboxField({ label, description, id, className, ...props }: CheckboxFieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <input
        id={inputId}
        type="checkbox"
        aria-describedby={description ? `${inputId}-description` : undefined}
        className="border-border accent-primary focus-visible:ring-ring mt-0.5 size-4 shrink-0 rounded focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
        {...props}
      />
      <div className="space-y-0.5">
        <label htmlFor={inputId} className="text-sm leading-none font-medium">
          {label}
        </label>
        {description ? (
          <p id={`${inputId}-description`} className="text-muted-foreground text-sm">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
