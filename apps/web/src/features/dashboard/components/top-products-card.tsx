'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { Currency } from '@/components/patterns/currency';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ProductPerformance } from '@/features/dashboard/api/dashboard.api';

export interface TopProductsCardProps {
  variant: 'profitable' | 'lossy';
  products: readonly ProductPerformance[] | undefined;
}

export function TopProductsCard({ variant, products }: TopProductsCardProps): React.ReactElement {
  const t = useTranslations();
  const titleKey =
    variant === 'profitable' ? 'dashboard.section.topProfitable' : 'dashboard.section.topLossy';
  const tone = variant === 'profitable' ? 'text-success' : 'text-destructive';

  return (
    <Card className="gap-md p-lg flex flex-col">
      <h2 className="text-foreground text-base font-semibold">{t(titleKey)}</h2>
      {!products || products.length === 0 ? (
        <div className="text-muted-foreground py-md text-center text-sm">—</div>
      ) : (
        <ul className="gap-3xs flex flex-col text-sm">
          {products.map((p) => (
            <li
              key={p.id}
              className="border-border py-xs flex items-center justify-between border-b last:border-b-0"
            >
              <span className="text-foreground truncate">{p.name}</span>
              <Currency value={p.delta} className={cn('font-semibold tabular-nums', tone)} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
