'use client';

import { SparklesIcon } from 'hugeicons-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';

export interface TariffBestRibbonProps {
  /** The "En kârlı" copy — the caller owns the i18n lookup. */
  label: string;
}

/**
 * The featured "En kârlı" ribbon straddling the top border of a {@link
 * TariffOptionCard}. Absolute + `-translate-y-1/2` so it adds NO height (every card
 * still starts at its price, keeping the prices aligned across the row) and
 * `pointer-events-none` so a click on it still reaches the card's select overlay;
 * `z-10` keeps it above the option content. Shared by the card-framed options — the
 * preset bands ({@link PriceBandCell}) and the custom-price card ({@link
 * CustomPriceCell}).
 *
 * The commission row keeps a single marker icon everywhere: this ribbon and the
 * frameless CURRENT cell both use the same Sparkles glyph. That current cell has no
 * card frame to straddle, so it renders the marker as an in-flow badge (not this
 * absolute ribbon) via {@link TariffCurrentCell}'s reserved slot.
 */
export function TariffBestRibbon({ label }: TariffBestRibbonProps): React.ReactElement {
  return (
    <Badge
      tone="primary"
      variant="solid"
      radius="full"
      leadingIcon={<SparklesIcon />}
      className="text-2xs px-2xs gap-3xs left-sm pointer-events-none absolute top-0 z-10 -translate-y-1/2 py-0 font-medium [&_svg]:size-3"
    >
      {label}
    </Badge>
  );
}
