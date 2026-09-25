'use client';

import { formatMoney, parseMoney } from '@emis/contracts';
import { Field, type FieldProps } from '@emis/ui/components/field';

import { useInstitution } from '@/features/institution/use-institution';

/** Formats whole minor units (santim) in the institution's currency. Never do money maths with floats. */
export function useMoney() {
  const { profile } = useInstitution();
  const currency = profile?.currency ?? 'ETB';
  return {
    currency,
    fmt: (minorUnits: number) => formatMoney(minorUnits, currency),
  };
}

/** A text box for an amount in birr (or the institution's currency), e.g. "1,500.50"; reports santim. */
export function MoneyInput({
  value,
  onChange,
  ...props
}: Omit<FieldProps, 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (text: string, minorUnits: number | null) => void;
}) {
  return (
    <Field
      inputMode="decimal"
      autoComplete="off"
      placeholder="0.00"
      {...props}
      value={value}
      onChange={(event) => onChange(event.target.value, parseMoney(event.target.value))}
    />
  );
}

/** "12,50" style entry is refused; the message to show when the text isn't a valid amount. */
export const MONEY_HINT = 'Use numbers with up to two decimals, e.g. 1500 or 1,500.50';
