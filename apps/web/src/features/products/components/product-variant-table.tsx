'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type { VariantSummary } from '../api/list-products.api';

import { DeliveryBadge } from './delivery-badge';
import { VariantStatusBadge } from './variant-status-badge';

interface ProductVariantTableProps {
  variants: VariantSummary[];
}

/**
 * Inline sub-table rendered when a multi-variant parent row is expanded.
 * Borderless to differentiate from the parent table; reads the same
 * tokens for typography, so it nests cleanly within DataTable's own
 * <tbody>.
 */
export function ProductVariantTable({ variants }: ProductVariantTableProps): React.ReactElement {
  const t = useTranslations('products.columns');
  const formatter = useFormatter();

  return (
    <div className="px-md py-sm">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{t('size')}</TableHead>
            <TableHead>{t('stockCode')}</TableHead>
            <TableHead>{t('barcode')}</TableHead>
            <TableHead className="text-right">{t('salePrice')}</TableHead>
            <TableHead className="text-right">{t('stock')}</TableHead>
            <TableHead>{t('delivery')}</TableHead>
            <TableHead>{t('status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {variants.map((variant) => (
            <TableRow key={variant.id} className="hover:bg-transparent">
              <TableCell className="text-foreground">{variant.size ?? '—'}</TableCell>
              <TableCell className="font-mono text-xs">{variant.stockCode}</TableCell>
              <TableCell className="font-mono text-xs">{variant.barcode}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatter.number(Number.parseFloat(variant.salePrice), 'currency')}
              </TableCell>
              <TableCell className="text-right tabular-nums">{variant.quantity}</TableCell>
              <TableCell>
                <DeliveryBadge
                  durationDays={variant.deliveryDuration}
                  isRush={variant.isRushDelivery}
                />
              </TableCell>
              <TableCell>
                <VariantStatusBadge status={variant.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
