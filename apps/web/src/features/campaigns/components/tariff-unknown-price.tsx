import * as React from 'react';

/** How prominent the unknown label is: a card's hero amount, or one small meta line. */
export type TariffUnknownPriceSize = 'hero' | 'line';

export interface TariffUnknownPriceProps {
  /** The muted text shown in place of a value (e.g. "Unknown"); the caller owns the wording. */
  label: string;
  /**
   * Optional explanation, rendered as its own short muted line under the label. Plain
   * text, so it wraps inside the card at phone width and reads on touch devices too
   * (no hover needed).
   */
  hint?: React.ReactNode;
  /**
   * `hero` (default) sizes the label like a card's hero amount (an unknown price);
   * `line` sizes it like the small meta line under the hero (an unknown commission
   * percent). The hint line looks the same in both.
   */
  size?: TariffUnknownPriceSize;
}

const LABEL_CLASS: Record<TariffUnknownPriceSize, string> = {
  hero: 'text-muted-foreground text-base font-semibold',
  line: 'text-2xs text-muted-foreground font-medium',
};

/**
 * An unknown value of a tariff option (or current baseline): a muted label, never a
 * made-up amount, and the caller's explanation (if any) as a line under it. Purely
 * presentational and wrapper-free (a fragment), so it drops into the caller's own flex
 * column. Shared by {@link TariffCurrentCell}, {@link PriceBandCell} and
 * {@link PlusBandCell}: the hero size stands in for an unknown price, the line size for
 * an unknown commission percent.
 */
export function TariffUnknownPrice({
  label,
  hint,
  size = 'hero',
}: TariffUnknownPriceProps): React.ReactElement {
  return (
    <>
      <span className={LABEL_CLASS[size]}>{label}</span>
      {hint != null ? <span className="text-2xs text-muted-foreground">{hint}</span> : null}
    </>
  );
}
