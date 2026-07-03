import Image from 'next/image';

import { cn } from '@/lib/utils';

/**
 * Trendyol "Plus" brand wordmark (multi-color gradient). Loaded from
 * `public/brands/trendyol-plus.svg` so the vendor's brand gradient is preserved —
 * dashboard tokens intentionally don't carry vendor colors (they belong to
 * Trendyol, not PazarSync), exactly like {@link MarketplaceLogo}.
 *
 * Height comes from `className` (default `h-4`, matching the sidebar icon slot);
 * width auto-scales to the SVG's natural aspect ratio (`w-auto`). The signature is
 * `{ className }` so it satisfies the sidebar nav's icon contract
 * (`React.ComponentType<{ className?: string }>`) AND drops into any header beside
 * a visible label. Decorative (`alt=""`) — always paired with a text label.
 *
 * SVG is delivered `unoptimized` by next/image (already tiny; next/image refuses
 * to optimize SVG by default; /public cache-control is browser-managed) — same
 * rationale as MarketplaceLogo / LocaleFlag.
 *
 * @useWhen branding a Trendyol-Plus surface (the Plus commission tariffs nav item + page header) with the vendor-correct gradient preserved
 */
const SRC = '/brands/trendyol-plus.svg';

// Intrinsic aspect-ratio hint for next/image (real height is CSS-driven; this
// only prevents layout shift on paint). Matches the source viewBox (29×15).
const INTRINSIC = { width: 29, height: 15 } as const;

export interface TrendyolPlusLogoProps {
  className?: string;
}

export function TrendyolPlusLogo({ className }: TrendyolPlusLogoProps): React.ReactElement {
  return (
    <Image
      src={SRC}
      alt=""
      width={INTRINSIC.width}
      height={INTRINSIC.height}
      unoptimized
      className={cn('h-4 w-auto shrink-0', className)}
    />
  );
}
