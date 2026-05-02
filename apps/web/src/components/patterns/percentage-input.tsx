'use client';

import Decimal from 'decimal.js';
import * as React from 'react';

import { formatTrMoney, parseTrMoney } from '@/components/patterns/money-input';
import { Input, type InputProps } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Percentage input. Same tr-TR parser + Decimal output as MoneyInput,
 * with `%` as the leading slot — matches Turkish convention ("%23,64",
 * not "23,64%"). Use for commission rates, tax rates, profit margins,
 * discounts — anywhere the user enters a percent value.
 *
 * Range is intentionally NOT bounded by default (commission rates can
 * be > 100%, profit margins can be negative, etc). Wrap with a custom
 * `nonNegative` prop or validate at the form layer when a feature
 * needs strict bounds.
 *
 * Shares the display-buffer behavior of MoneyInput: in-progress typing
 * survives parent-driven re-renders. Decimal.js end-to-end so 23,64
 * stays exact rather than 23.640000000001.
 *
 * For monetary entry use MoneyInput; for raw numeric entry without
 * either symbol use Input `type="number"`.
 *
 * @useWhen accepting a percentage as form input — commission rate, tax rate, margin, discount (use MoneyInput for currency; use Input type=number for raw integers)
 */

export interface PercentageInputProps extends Omit<
  InputProps,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'leading' | 'leadingIcon' | 'inputMode'
> {
  /** Controlled value. `null` represents an empty field. */
  value?: Decimal | null;
  /** Uncontrolled initial value. */
  defaultValue?: Decimal | null;
  /** Fires on every keystroke with the parsed Decimal (or null when empty/invalid). */
  onChange?: (next: Decimal | null) => void;
  /** Max decimal places to display (default 2 — covers 23,64 commissions). */
  scale?: number;
  /** When true, negative input is auto-flipped to positive on emit. */
  nonNegative?: boolean;
  /** Override the leading symbol. Defaults to %. */
  symbol?: string;
}

export const PercentageInput = React.forwardRef<HTMLInputElement, PercentageInputProps>(
  function PercentageInput(
    { value, defaultValue, onChange, scale = 2, nonNegative = false, symbol = '%', ...inputProps },
    ref,
  ) {
    const [displayString, setDisplayString] = React.useState<string>(() => {
      const initial = defaultValue ?? value ?? null;
      return initial !== null && initial !== undefined ? formatTrMoney(initial, scale) : '';
    });

    React.useEffect(() => {
      if (value === undefined) return; // uncontrolled — never sync from prop
      const parsed = parseTrMoney(displayString);
      const matches =
        (value === null && parsed === null) ||
        (value !== null && parsed !== null && parsed.eq(value));
      if (!matches) {
        setDisplayString(value !== null ? formatTrMoney(value, scale) : '');
      }
    }, [value, scale, displayString]);

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
      const raw = event.target.value;
      setDisplayString(raw);
      const parsed = parseTrMoney(raw);
      if (parsed === null) {
        onChange?.(null);
        return;
      }
      onChange?.(nonNegative && parsed.isNegative() ? parsed.abs() : parsed);
    };

    return (
      <Input
        ref={ref}
        {...inputProps}
        value={displayString}
        onChange={handleChange}
        leading={<span className="text-muted-foreground text-sm">{symbol}</span>}
        inputMode="decimal"
        className={cn('tabular-nums', inputProps.className)}
      />
    );
  },
);
