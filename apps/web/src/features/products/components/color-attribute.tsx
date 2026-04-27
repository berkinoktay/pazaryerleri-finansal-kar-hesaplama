'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

interface ColorAttributeProps {
  color: string | null;
  className?: string;
}

/**
 * Renders the product's color attribute as a label. Trendyol returns
 * color as a free-text string (Turkish — "Beyaz", "Mavi", "Lacivert"),
 * so we don't try to map it to a swatch — just label it. If/when we
 * gain a structured color → hex map, we can add a swatch dot here.
 */
export function ColorAttribute({
  color,
  className,
}: ColorAttributeProps): React.ReactElement | null {
  if (color === null || color.length === 0) return null;
  return <span className={cn('text-foreground text-sm', className)}>{color}</span>;
}
