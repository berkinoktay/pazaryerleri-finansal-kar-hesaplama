'use client';

import { Image01Icon } from 'hugeicons-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Square or circular thumbnail for table cells and dense list rows.
 * Wraps a raw `<img>` (not `next/image`) so callers don't have to
 * register every marketplace CDN under `images.remotePatterns`. When
 * `src` is missing, fails to load, or is an empty string, an opaque
 * placeholder takes its place — either a neutral icon (default) or
 * the alt text's initials (`fallback="initials"`, useful for customer
 * + team avatars).
 *
 * Four size presets line up with the typical row densities:
 *
 *   sm (32px) — compact tables, dense lists
 *   md (40px) — default for product / customer rows
 *   lg (56px) — header avatars, spotlight cards
 *   xl (80px) — spotlight product thumbnails on data-dense pages where
 *               the seller needs to identify a SKU at a glance
 *
 * `shape="circle"` swaps the default `rounded-md` corner for a circle
 * — paired with `fallback="initials"` it reads as the canonical avatar
 * primitive.
 *
 * Domain wrappers (e.g. `ProductImageCell`) compose this with their
 * own defaults rather than re-implementing the fallback / lazy /
 * onError plumbing — same WET+1 promotion logic that motivated
 * MappedBadge in PR #130.
 *
 * @useWhen rendering a fixed-footprint image inside a table cell or list row with a built-in fallback for missing / failed loads (use ImageCell with shape=circle + fallback=initials for avatar-style cells)
 */

export type ImageCellSize = 'sm' | 'md' | 'lg' | 'xl';
export type ImageCellShape = 'square' | 'circle';
export type ImageCellFallback = 'icon' | 'initials';

const SIZE_CLASS: Record<ImageCellSize, string> = {
  sm: 'size-thumb-sm',
  md: 'size-thumb-md',
  lg: 'size-thumb-lg',
  xl: 'size-thumb-xl',
};

export interface ImageCellProps {
  /** Image URL. `null` / `undefined` / empty string all render the fallback. */
  src: string | null | undefined;
  /** Required for accessibility. Doubles as the source of initials when `fallback="initials"`. */
  alt: string;
  size?: ImageCellSize;
  shape?: ImageCellShape;
  /** What to render when `src` is missing or fails to load. Defaults to `icon`. */
  fallback?: ImageCellFallback;
  className?: string;
}

export function ImageCell({
  src,
  alt,
  size = 'md',
  shape = 'square',
  fallback = 'icon',
  className,
}: ImageCellProps): React.ReactElement {
  const [errored, setErrored] = React.useState(false);
  const isMissing = src === null || src === undefined || src.length === 0;
  const showFallback = isMissing || errored;

  return (
    <div
      // Initials fallback semantically represents the same image as
      // the real src would — expose it as role="img" so assistive tech
      // sees the alt text. The icon fallback is decorative.
      role={showFallback && fallback === 'initials' ? 'img' : undefined}
      aria-label={showFallback && fallback === 'initials' ? alt : undefined}
      className={cn(
        SIZE_CLASS[size],
        shape === 'circle' ? 'rounded-full' : 'rounded-md',
        'bg-muted relative flex shrink-0 items-center justify-center overflow-hidden',
        className,
      )}
    >
      {showFallback ? (
        fallback === 'initials' ? (
          <span
            aria-hidden
            className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
          >
            {extractInitials(alt)}
          </span>
        ) : (
          <Image01Icon aria-hidden className="text-muted-foreground size-icon-sm" />
        )
      ) : (
        <img
          src={src ?? ''}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setErrored(true)}
          className="size-full object-cover"
        />
      )}
    </div>
  );
}

function extractInitials(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
