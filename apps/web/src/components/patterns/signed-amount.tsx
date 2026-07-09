'use client';

import * as React from 'react';

import { Currency } from '@/components/patterns/currency';

export interface SignedAmountProps {
  /** Backend-served amount string; may already carry a `-` sign (e.g. negative Net KDV). */
  value: string;
  /**
   * `true` = a positive-direction row (e.g. Satış KDV), `false` = a deduction row.
   * A negative served value flips the glyph: a negative Net KDV is seller-favorable (+).
   */
  positive: boolean;
}

/**
 * Display-only signed amount. The value can arrive signed from the backend
 * (negative Net KDV = input VAT > output). We derive the glyph from the STRING,
 * never from arithmetic (feedback_no_frontend_financial_calculation): the
 * magnitude goes to `<Currency>` and we prefix `−`/`+` ourselves so Intl doesn't
 * also print its own minus (which would double up to `−-₺`).
 */
export function SignedAmount({ value, positive }: SignedAmountProps): React.ReactElement {
  const isNegative = value.startsWith('-');
  const magnitude = isNegative ? value.slice(1) : value;
  const showMinus = positive ? isNegative : !isNegative;
  return (
    // whitespace-nowrap: the glyph must never wrap onto its own line (a lone "−"
    // read as an em-dash in a narrow column).
    <span className="whitespace-nowrap tabular-nums">
      {showMinus ? '−' : '+'}
      <Currency value={magnitude} />
    </span>
  );
}
