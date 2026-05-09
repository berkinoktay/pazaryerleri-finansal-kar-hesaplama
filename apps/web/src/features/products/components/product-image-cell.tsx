'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ImageCell, type ImageCellSize } from '@/components/patterns/image-cell';
import { ImageModal } from '@/components/ui/image-modal';
import { cn } from '@/lib/utils';

interface ProductImageCellProps {
  url: string | null | undefined;
  alt: string;
  /**
   * 'lg' (56px) — parent product rows. Large enough to identify a SKU
   *               at a glance without dominating the row.
   * 'md' (40px) — variant sub-rows. Echoes the parent's image at a
   *               smaller size so the visual relationship is obvious
   *               and rows stay scannable.
   *
   * Defaults to 'lg' for backwards compatibility.
   */
  size?: Extract<ImageCellSize, 'md' | 'lg'>;
  className?: string;
}

/**
 * Domain wrapper around `ImageCell` for the products table. Clicking
 * the thumbnail opens the shared `ImageModal` so the original image
 * fills the viewport for closer inspection.
 *
 * Sizing rationale: 56px is the comfortable middle ground for a parent
 * row (40px lacked detail, 80px made rows feel image-heavy). Variant
 * sub-rows step down to 40px so the hierarchy is visible at a glance —
 * smaller image == nested.
 *
 * Carries `data-row-action` so DataTable's row-click handler doesn't
 * also fire when the user opens the image. Disabled when `url` is
 * null/empty (the icon fallback stays, just inert).
 */
export function ProductImageCell({
  url,
  alt,
  size = 'lg',
  className,
}: ProductImageCellProps): React.ReactElement {
  const t = useTranslations('products.a11y');
  const [open, setOpen] = React.useState(false);
  const hasImage = url !== null && url !== undefined && url.length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('viewImage')}
        // `data-row-action` opts this button out of DataTable's row-click
        // activation — the click opens the image modal, not the row.
        data-row-action
        disabled={!hasImage}
        className={cn(
          'rounded-md',
          'duration-fast transition-opacity',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          hasImage && 'cursor-zoom-in hover:opacity-80',
          !hasImage && 'cursor-default',
        )}
      >
        <ImageCell src={url} alt={alt} size={size} className={className} />
      </button>
      <ImageModal src={url} alt={alt} open={open} onOpenChange={setOpen} />
    </>
  );
}
