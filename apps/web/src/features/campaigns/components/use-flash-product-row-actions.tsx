'use client';

import { ArrowRight01Icon, Delete02Icon, Download04Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { type RowAction } from '@/components/patterns/data-table-row-actions';

import { useCampaignAccess } from '../lib/campaign-access-context';
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
  const { canWrite } = useCampaignAccess();

  return React.useMemo(() => {
    const open: RowAction<FlashProductListRow> = {
      label: t('open'),
      icon: <ArrowRight01Icon />,
      onSelect: (row) => onOpen(row.id),
    };
    // Export and delete are writes: a member who cannot write only opens the row.
    if (!canWrite) return [open];
    return [
      open,
      { label: t('export'), icon: <Download04Icon />, onSelect: (row) => onExport(row.id) },
      {
        label: t('delete'),
        icon: <Delete02Icon />,
        onSelect: (row) => onRequestDelete(row),
        tone: 'destructive',
        separatorBefore: true,
      },
    ];
  }, [canWrite, t, onOpen, onExport, onRequestDelete]);
}
