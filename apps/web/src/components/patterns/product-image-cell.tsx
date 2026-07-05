'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ImageCell, type ImageCellFit, type ImageCellSize } from '@/components/patterns/image-cell';
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
   * 'xl' (80px) — tariff-detail rows, sized to match the identity block
   *               so the product reads at the same scale as its name.
   *
   * Defaults to 'lg' for backwards compatibility.
   */
  size?: Extract<ImageCellSize, 'md' | 'lg' | 'xl'>;
  /** Image fit — passthrough to {@link ImageCell}; defaults to `cover`. */
  fit?: ImageCellFit;
  className?: string;
}

/**
 * Shared product-thumbnail cell: an `ImageCell` whose click opens the
 * shared `ImageModal` so the original image fills the viewport for closer
 * inspection. Reused across product-facing surfaces (products table,
 * commission-tariff detail) so a seller can always eyeball the SKU.
 *
 * Sizing rationale: 56px ('lg') is the comfortable middle ground for a
 * parent row (40px lacked detail, 80px made rows feel image-heavy). Dense
 * or nested rows step down to 40px ('md') so the hierarchy is visible at a
 * glance — smaller image == nested. The tariff-detail table steps UP to
 * 80px ('xl') so the thumbnail matches its identity block's height and the
 * seller can eyeball the SKU beside the two-line name.
 *
 * Carries `data-row-action` so DataTable's row-click handler doesn't
 * also fire when the user opens the image. Disabled when `url` is
 * null/empty (the icon fallback stays, just inert).
 */
export function ProductImageCell({
  url,
  alt,
  size = 'lg',
  fit,
  className,
}: ProductImageCellProps): React.ReactElement {
  const t = useTranslations('common.a11y');
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
        <ImageCell src={url} alt={alt} size={size} fit={fit} className={className} />
      </button>
      <ImageModal src={url} alt={alt} open={open} onOpenChange={setOpen} />
    </>
  );
}
