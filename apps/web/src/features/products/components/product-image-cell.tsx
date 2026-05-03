'use client';

import * as React from 'react';

import { ImageCell } from '@/components/patterns/image-cell';

interface ProductImageCellProps {
  url: string | null | undefined;
  alt: string;
  className?: string;
}

/**
 * Domain wrapper around `ImageCell` for the products table. Locks in
 * the `size="md"` / `shape="square"` / `fallback="icon"` defaults that
 * fit Trendyol product thumbnails and delegates the actual image +
 * fallback plumbing to the shared pattern. Existing call sites stay
 * source-compatible — same `{url, alt, className}` API.
 */
export function ProductImageCell({
  url,
  alt,
  className,
}: ProductImageCellProps): React.ReactElement {
  return <ImageCell src={url} alt={alt} className={className} />;
}
