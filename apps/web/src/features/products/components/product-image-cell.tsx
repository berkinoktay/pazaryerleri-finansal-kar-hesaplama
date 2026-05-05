'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ImageCell } from '@/components/patterns/image-cell';
import { ImageModal } from '@/components/ui/image-modal';
import { cn } from '@/lib/utils';

interface ProductImageCellProps {
  url: string | null | undefined;
  alt: string;
  className?: string;
}

/**
 * Domain wrapper around `ImageCell` for the products table. Renders a
 * 56px square thumbnail (size="lg") — large enough to identify a SKU
 * at a glance without dominating the row or pushing the title cell to
 * the right. Clicking the thumbnail opens the shared `ImageModal` so
 * the original image fills the viewport for closer inspection.
 *
 * Sizing rationale: 40px (the original `md`) didn't carry enough
 * detail for marketplace product identification; 80px (`xl`) made
 * rows feel image-heavy and pushed the cell layout out of balance.
 * 56px is the comfortable middle ground and matches how Tiyasis,
 * Trendyol seller panel, and similar marketplace dashboards size
 * their list-view product thumbnails.
 *
 * Carries `data-row-action` so DataTable's row-click handler doesn't
 * also fire when the user opens the image. Disabled when `url` is
 * null/empty (the icon fallback stays, just inert).
 */
export function ProductImageCell({
  url,
  alt,
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
        <ImageCell src={url} alt={alt} size="lg" className={className} />
      </button>
      <ImageModal src={url} alt={alt} open={open} onOpenChange={setOpen} />
    </>
  );
}
