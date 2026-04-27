'use client';

import { Image01Icon } from 'hugeicons-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

interface ProductImageCellProps {
  url: string | null | undefined;
  alt: string;
  className?: string;
}

/**
 * Square thumbnail for the products table. Uses a regular <img> rather
 * than next/image so we don't need to configure remotePatterns for
 * cdn.dsmcdn.com — the Trendyol CDN. Falls back to a placeholder icon
 * when the URL is missing or fails to load.
 */
export function ProductImageCell({
  url,
  alt,
  className,
}: ProductImageCellProps): React.ReactElement {
  const [errored, setErrored] = React.useState(false);
  const showFallback = url === null || url === undefined || url.length === 0 || errored;

  return (
    <div
      className={cn(
        'bg-muted relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md',
        className,
      )}
    >
      {showFallback ? (
        <Image01Icon className="text-muted-foreground size-icon-sm" aria-hidden />
      ) : (
        <img
          src={url}
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
