'use client';

import * as React from 'react';

import { Badge } from '@/components/ui/badge';

interface SizeChipListProps {
  sizes: string[];
  extraCount: number;
}

export function SizeChipList({ sizes, extraCount }: SizeChipListProps): React.ReactElement {
  if (sizes.length === 0 && extraCount === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="gap-3xs flex flex-wrap items-center">
      {sizes.map((size) => (
        <Badge key={size} tone="outline" size="sm" radius="md">
          {size}
        </Badge>
      ))}
      {extraCount > 0 ? (
        <Badge tone="neutral" size="sm" radius="md">
          +{extraCount}
        </Badge>
      ) : null}
    </div>
  );
}
