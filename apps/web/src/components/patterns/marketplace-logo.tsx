import Image from 'next/image';

import { cn } from '@/lib/utils';

/**
 * Marketplace brand mark. Loaded from `public/brands/<platform>.svg` so
 * vendor brand colors are preserved (Trendyol orange, Hepsiburada
 * red) — dashboard tokens intentionally don't carry these since they
 * belong to vendors, not PazarSync.
 *
 * Use in PlatformCard, store list rows, sync-source badges, and any
 * cross-feature surface where "which marketplace?" is a one-glance
 * recognition question.
 *
 * SVGs are delivered unoptimized by next/image because:
 *   (1) SVGs are already smaller than any optimized raster would be;
 *   (2) next/image refuses to optimize SVG by default for security;
 *   (3) the files live under /public so cache-control is browser-managed.
 */
export type MarketplacePlatform = 'TRENDYOL' | 'HEPSIBURADA';

const PLATFORM_SRC: Record<MarketplacePlatform, string> = {
  TRENDYOL: '/brands/trendyol.svg',
  HEPSIBURADA: '/brands/hepsiburada.svg',
};

/**
 * Rendered height per size; width is driven by CSS `w-auto` so each
 * wordmark's natural aspect ratio is preserved. The Next.js `width`
 * attribute is a hint for intrinsic size only — the class below wins.
 */
const SIZE_CLASS: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl', string> = {
  xs: 'h-3.5', // 14px — corner badge on org avatar, switcher list rows
  sm: 'h-5', // 20px — inline sub-text
  md: 'h-7', // 28px — empty-state pill / compact surface
  lg: 'h-10', // 40px — store list main identifier, left-aligned
  xl: 'h-14', // 56px — secondary card / sync source badge
  '2xl': 'h-20', // 80px — platform selection hero card
};

// Rough intrinsic sizing hints for Next.js Image. The rendered height
// is set by CSS; these just tell the browser not to layout-shift on
// paint. Real width is SVG-aspect-ratio driven at runtime.
const INTRINSIC = { width: 120, height: 24 } as const;

export interface MarketplaceLogoProps {
  platform: MarketplacePlatform;
  /** Rendered height. Width auto-scales with the SVG's natural aspect ratio. */
  size?: keyof typeof SIZE_CLASS;
  /**
   * Accessible label. Pass the localised marketplace name for screen
   * readers, or `''` if the logo sits next to a visible text label (in
   * which case the logo is decorative).
   */
  alt: string;
  className?: string;
}

export function MarketplaceLogo({
  platform,
  size = 'md',
  alt,
  className,
}: MarketplaceLogoProps): React.ReactElement {
  return (
    <Image
      src={PLATFORM_SRC[platform]}
      alt={alt}
      width={INTRINSIC.width}
      height={INTRINSIC.height}
      unoptimized
      className={cn(SIZE_CLASS[size], 'w-auto shrink-0', className)}
    />
  );
}
