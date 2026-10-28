'use client';

import Decimal from 'decimal.js';
import * as React from 'react';

import { Input, type InputProps } from '@/components/ui/input';
import { formatTrDecimal, parseTrDecimal } from '@/lib/parse-tr-decimal';
import { cn } from '@/lib/utils';

/**
 * Turkish Lira monetary input. Displays the currency symbol as a
 * leading slot and parses tr-TR numeric strings ("1.234,50") into a
 * `Decimal` for type-safe money math throughout the product. Pairs
 * with the `Currency` display pattern — same value contract, so a
 * value entered here renders identically when read back via
 * `<Currency value={...} />`.
 *
 * The input maintains its own display-string buffer so in-progress
 * typing (e.g. "1," before the user types the decimal) survives parent-
 * driven re-renders. The buffer is overwritten only when the parent's
 * `value` no longer matches what the buffer would parse to — so a
 * programmatic reset works, but a controlled re-render with the same
 * Decimal does not clobber typing.
 *
 * For percentage entry use the future PercentageInput; for raw integer
 * entry without currency formatting use Input `type="number"`.
 *
 * @useWhen accepting a TRY monetary value as form input (use PercentageInput for %, Input type="number" for raw integers, Currency for read-only display)
 */

/**
 * Parse a tr-TR money string into a Decimal: "1.234,50" -> 1234.5,
 * "1234" -> 1234, "-12,5" -> -12.5, "" or "abc" -> null. A thin wrapper over
 * the shared `parseTrDecimal` (`@/lib/parse-tr-decimal`) in grouping mode,
 * where '.' is a thousands separator and ',' the decimal separator.
 *
 * Returns `null` for empty / unparseable input so callers can distinguish
 * "user cleared the field" from "user typed 0".
 */
export function parseTrMoney(input: string): Decimal | null {
  return parseTrDecimal(input, { grouping: true });
}

/**
 * Format a Decimal as a tr-TR display string (no thousand separators, no
 * symbol). Thousand separators are left out while editing because they jitter
 * under the caret; read-only Currency display is where grouping belongs.
 * Delegates to the shared `formatTrDecimal`; `scale` is the max fraction digits.
 */
export function formatTrMoney(value: Decimal, scale = 2): string {
  return formatTrDecimal(value, scale);
}

export interface MoneyInputProps extends Omit<
  InputProps,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'leading' | 'leadingIcon' | 'inputMode' | 'max'
> {
  /** Controlled value. `null` represents an empty field. */
  value?: Decimal | null;
  /** Uncontrolled initial value. */
  defaultValue?: Decimal | null;
  /** Fires on every keystroke with the parsed Decimal (or null when empty/invalid). */
  onChange?: (next: Decimal | null) => void;
  /** Max decimal places to display (default 2 for currency; 0 for whole TRY). */
  scale?: number;
  /** When true, negative input is auto-flipped to positive on emit. */
  nonNegative?: boolean;
  /**
   * Numeric ceiling. A keystroke that would push the parsed value above `max`
   * is REJECTED (the field simply stops accepting digits, like `maxLength` but
   * decimal-aware — `maxLength` can't tell `9999999,99` from `9999999999`).
   */
  max?: Decimal;
  /** Override the leading currency symbol. Defaults to ₺. */
  symbol?: string;
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  {
    value,
    defaultValue,
    onChange,
    scale = 2,
    nonNegative = false,
    max,
    symbol = '₺',
    ...inputProps
  },
  ref,
) {
  const [displayString, setDisplayString] = React.useState<string>(() => {
    const initial = defaultValue ?? value ?? null;
    return initial !== null && initial !== undefined ? formatTrMoney(initial, scale) : '';
  });

  // Controlled-mode sync: only overwrite the display when the parent's
  // value diverges from what the current buffer would parse to. This
  // preserves in-progress strings like "1," (parses to Decimal(1) which
  // matches a parent value of Decimal(1)) while still honoring real
  // parent-driven resets.
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
    // Numeric-only: strip anything that isn't a digit, a tr-TR separator, or a
    // sign, so letters/symbols never land in a money field (keyboard or paste).
    const raw = event.target.value.replace(/[^0-9.,-]/g, '');
    const parsed = parseTrMoney(raw);
    if (parsed === null) {
      setDisplayString(raw);
      onChange?.(null);
      return;
    }
    const next = nonNegative && parsed.isNegative() ? parsed.abs() : parsed;
    // Over the ceiling → refuse the keystroke: buffer and value both stay put.
    if (max !== undefined && next.greaterThan(max)) return;
    setDisplayString(raw);
    onChange?.(next);
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
});
