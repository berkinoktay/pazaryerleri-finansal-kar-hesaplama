import Image from 'next/image';

import { cn } from '@/lib/utils';

/**
 * Full "trendyol plus" horizontal brand lockup (flame mark + "trendyol plus"
 * wordmark). Loaded from `public/brands/trendyol-plus-lockup.webp` so the vendor's
 * brand colors are preserved — dashboard tokens intentionally don't carry vendor
 * colors, exactly like {@link MarketplaceLogo} and {@link TrendyolPlusLogo}.
 *
 * Used to brand a Plus screen's PAGE HEADER (beside the title). Height comes from
 * `className` (default `h-6`); width auto-scales to the source aspect ratio (~5:1).
 * Decorative (`alt=""`) — always paired with a visible title.
 *
 * NOTE (dark mode): the lockup's "trendyol" word is BLACK, so on a dark background
 * it loses contrast (only the flame + gradient "plus" stay legible). The asset has
 * a transparent background (no white box), but a dark-safe variant would need a
 * light-text version of the wordmark. Flagged for the owner.
 *
 * @useWhen branding a Trendyol-Plus page header with the full "trendyol plus" lockup
 */
const SRC = '/brands/trendyol-plus-lockup.webp';

// Intrinsic aspect-ratio hint for next/image (real height is CSS-driven; this
// only prevents layout shift on paint). Matches the source dimensions (248×49).
const INTRINSIC = { width: 248, height: 49 } as const;

export interface TrendyolPlusLockupProps {
  className?: string;
}

export function TrendyolPlusLockup({ className }: TrendyolPlusLockupProps): React.ReactElement {
  return (
    <Image
      src={SRC}
      alt=""
      width={INTRINSIC.width}
      height={INTRINSIC.height}
      unoptimized
      className={cn('h-6 w-auto shrink-0', className)}
    />
  );
}
