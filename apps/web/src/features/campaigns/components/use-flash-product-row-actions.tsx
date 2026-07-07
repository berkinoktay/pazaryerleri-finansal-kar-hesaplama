'use client';

import { ArrowRight01Icon, Delete02Icon, Download04Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { type RowAction } from '@/components/patterns/data-table-row-actions';

import type { FlashProductListRow } from '../lib/flash-product-list';

export interface FlashProductRowActionHandlers {
  onOpen: (id: string) => void;
  onExport: (id: string) => void;
  onRequestDelete: (row: FlashProductListRow) => void;
}

/**
 * Builds the kebab (overflow) actions for a Flash Products row — consumed by the list
 * table's row-actions column. Open and download act immediately; delete defers to the
 * page's confirm dialog via `onRequestDelete`.
 */
export function useFlashProductRowActions({
  onOpen,
  onExport,
  onRequestDelete,
}: FlashProductRowActionHandlers): RowAction<FlashProductListRow>[] {
  const t = useTranslations('flashProductsPage.list.actions');

  return React.useMemo(
    () => [
      { label: t('open'), icon: <ArrowRight01Icon />, onSelect: (row) => onOpen(row.id) },
      { label: t('export'), icon: <Download04Icon />, onSelect: (row) => onExport(row.id) },
      {
        label: t('delete'),
        icon: <Delete02Icon />,
        onSelect: (row) => onRequestDelete(row),
        tone: 'destructive',
        separatorBefore: true,
      },
    ],
    [t, onOpen, onExport, onRequestDelete],
  );
}
