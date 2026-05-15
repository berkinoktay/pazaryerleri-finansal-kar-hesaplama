'use client';

import { Loading03Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CommissionRatesLoadMoreProps {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  totalLoaded: number;
  onLoadMore: () => void;
}

/**
 * Cursor-pagination footer for the commission-rates table. Renders a
 * "Daha fazla yükle" button while there are more pages, then collapses
 * into a muted "tüm sonuçlar gösteriliyor — N satır" caption when the
 * cursor is exhausted. Hidden entirely when zero rows are loaded (the
 * empty state handles that case).
 */
export function CommissionRatesLoadMore({
  hasNextPage,
  isFetchingNextPage,
  totalLoaded,
  onLoadMore,
}: CommissionRatesLoadMoreProps): React.ReactElement | null {
  const t = useTranslations('features.commissionRates.loadMore');
  const formatter = useFormatter();

  if (totalLoaded === 0) return null;

  if (hasNextPage) {
    return (
      <div className="py-md flex items-center justify-center">
        <Button
          type="button"
          variant="outline"
          onClick={onLoadMore}
          disabled={isFetchingNextPage}
          className="gap-xs"
        >
          <Loading03Icon className={cn('size-icon-sm', isFetchingNextPage && 'animate-spin')} />
          {isFetchingNextPage ? t('loading') : t('button')}
        </Button>
      </div>
    );
  }

  return (
    <div className="py-md text-muted-foreground text-2xs flex items-center justify-center tabular-nums">
      {t('exhausted', { count: formatter.number(totalLoaded, 'integer') })}
    </div>
  );
}
