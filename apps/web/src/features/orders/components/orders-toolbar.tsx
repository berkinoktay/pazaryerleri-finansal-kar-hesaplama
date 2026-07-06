'use client';

import { type Table } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';

import { orderFilterParamsFromRows, orderFilterRowsFromParams } from '../lib/orders-filter-fields';
import {
  type OrderStatusValue,
  type ReconciliationStatusValue,
} from '../lib/orders-filter-parsers';
import { useOrderFilterFields } from '../hooks/use-order-filter-fields';

/** Partial filter update emitted by the toolbar — the page client owns the URL state. */
export interface OrdersToolbarChange {
  q?: string;
  status?: OrderStatusValue | null;
  reconciliationStatus?: ReconciliationStatusValue | null;
  lossOnly?: boolean;
  from?: string;
  to?: string;
}

export interface OrdersToolbarProps<TData> {
  table: Table<TData>;
  q: string;
  status: OrderStatusValue | null;
  reconciliationStatus: ReconciliationStatusValue | null;
  lossOnly: boolean;
  from: string;
  to: string;
  onChange: (next: OrdersToolbarChange) => void;
}

/**
 * Orders toolbar as a thin composition over the shared DataTableToolbar:
 * controlled search plus the `advancedFilter` config (order status +
 * reconciliation status as single-select chips, loss-only as a flag chip).
 * The orderDate DateRangePicker lives in the PageHeader `filters` slot, not
 * here — but `from`/`to` still flow through so the toolbar's "clear all"
 * affordance can reset the date range alongside the other dimensions. The URL
 * keeps its readable individual params — chips are DERIVED via the adapters in
 * orders-filter-fields.ts, so this component owns no filter state.
 *
 * The export button is a placeholder (no Excel backend yet) — a no-op
 * onExport keeps the standard control in place until the endpoint ships.
 */
export function OrdersToolbar<TData>({
  table,
  q,
  status,
  reconciliationStatus,
  lossOnly,
  from,
  to,
  onChange,
}: OrdersToolbarProps<TData>): React.ReactElement {
  const t = useTranslations('ordersPage');
  const filterFields = useOrderFilterFields();

  const filterRows = orderFilterRowsFromParams({ status, reconciliationStatus, lossOnly });

  // Server-mode clear: filters live in URL params (not columnFilters), so the
  // toolbar's ghost needs to be told when ANY of the six dimensions is active
  // and how to reset them all — search and the date range included, which the
  // chip row's own "Tümünü temizle" doesn't cover.
  const hasAnyFilter =
    q.length > 0 ||
    status !== null ||
    reconciliationStatus !== null ||
    lossOnly ||
    from.length > 0 ||
    to.length > 0;

  return (
    <DataTableToolbar
      table={table}
      searchValue={q}
      onSearchChange={(next) => onChange({ q: next })}
      searchPlaceholder={t('toolbar.searchPlaceholder')}
      advancedFilter={{
        fields: filterFields,
        value: filterRows,
        onApply: (rows) => onChange(orderFilterParamsFromRows(rows)),
      }}
      hasActiveFilters={hasAnyFilter}
      onClearFilters={() =>
        onChange({
          q: '',
          status: null,
          reconciliationStatus: null,
          lossOnly: false,
          from: '',
          to: '',
        })
      }
      onExport={() => {
        // Excel dışa aktarma backend'i henüz yok — yalnız yerleşim (no-op).
      }}
    />
  );
}
