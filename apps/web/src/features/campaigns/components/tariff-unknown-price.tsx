import * as React from 'react';

export interface TariffUnknownPriceProps {
  /** The muted hero text shown in place of an amount (e.g. "Unknown"); the caller owns the wording. */
  label: string;
  /**
   * Optional explanation, rendered as its own short muted line under the label. Plain
   * text, so it wraps inside the card at phone width and reads on touch devices too
   * (no hover needed).
   */
  hint?: React.ReactNode;
}

/**
 * The hero of a tariff option (or current baseline) whose price is unknown: a muted
 * label, never a made-up amount, and the caller's explanation (if any) as a line under
 * it. Purely presentational and wrapper-free (a fragment), so it drops into the
 * caller's own flex column. Shared by {@link TariffCurrentCell}, {@link PriceBandCell}
 * and {@link PlusBandCell}.
 */
export function TariffUnknownPrice({ label, hint }: TariffUnknownPriceProps): React.ReactElement {
  return (
    <>
      <span className="text-muted-foreground text-base font-semibold">{label}</span>
      {hint != null ? <span className="text-2xs text-muted-foreground">{hint}</span> : null}
    </>
  );
}
