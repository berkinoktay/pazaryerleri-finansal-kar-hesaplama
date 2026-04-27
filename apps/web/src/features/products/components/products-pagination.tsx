'use client';

import { ArrowLeft01Icon, ArrowRight01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { PRODUCT_PER_PAGE_OPTIONS } from '../lib/products-filter-parsers';

interface ProductsPaginationProps {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  onPageChange: (next: number) => void;
  onPerPageChange: (next: number) => void;
}

/**
 * Bottom row of the products table. Three regions:
 *   left:   "12–25 of 137 products" range readout
 *   center: per-page select
 *   right:  prev / next buttons + "page X of Y" label
 *
 * Uses ui/select for perPage (locked to {10, 25, 50, 100}) and bare
 * Buttons for page navigation — shadcn's ui/pagination component is
 * built around `<a href>` semantics that don't compose with nuqs's
 * imperative setter, so we render the controls directly.
 */
export function ProductsPagination({
  page,
  perPage,
  total,
  totalPages,
  onPageChange,
  onPerPageChange,
}: ProductsPaginationProps): React.ReactElement {
  const t = useTranslations('products.pagination');
  const formatter = useFormatter();

  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <div className="gap-md flex flex-wrap items-center justify-between">
      <p className="text-muted-foreground text-sm tabular-nums">
        {t('showing', {
          from: formatter.number(from, 'integer'),
          to: formatter.number(to, 'integer'),
          total: formatter.number(total, 'integer'),
        })}
      </p>
      <div className="gap-md flex items-center">
        <div className="gap-sm flex items-center">
          <span className="text-muted-foreground text-sm">{t('perPage')}</span>
          <Select
            value={perPage.toString()}
            onValueChange={(v) => onPerPageChange(Number.parseInt(v, 10))}
          >
            <SelectTrigger className="w-20" aria-label={t('perPage')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRODUCT_PER_PAGE_OPTIONS.map((n) => (
                <SelectItem key={n} value={n.toString()}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="gap-sm flex items-center">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(Math.max(1, page - 1))}
            aria-label={t('previous')}
          >
            <ArrowLeft01Icon className="size-icon-sm" />
          </Button>
          <span className="text-foreground text-sm tabular-nums">
            {page} / {totalPages === 0 ? 1 : totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            aria-label={t('next')}
          >
            <ArrowRight01Icon className="size-icon-sm" />
          </Button>
        </div>
      </div>
    </div>
  );
}
