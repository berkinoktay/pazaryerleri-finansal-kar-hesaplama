import { parseAsInteger, parseAsString, parseAsStringEnum } from 'nuqs';
import type { SortingState } from '@tanstack/react-table';

// Single source of truth for the URL ↔ React Query state binding on
// the orders page. Mirrors the backend's listOrdersQuerySchema — when
// the backend gains a new filter, add the parser here and the rest of
// the page reacts automatically.

export const ORDER_STATUSES = [
  'PENDING',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'RETURNED',
] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

export const RECONCILIATION_STATUSES = [
  'NOT_SETTLED',
  'PARTIALLY_SETTLED',
  'FULLY_SETTLED',
] as const;
export type ReconciliationStatusValue = (typeof RECONCILIATION_STATUSES)[number];

export const COST_STATUSES = ['calculated', 'excluded'] as const;
export type CostStatusValue = (typeof COST_STATUSES)[number];

// Wire sort keys (mirror the backend ORDER_LIST_SORTS). Default is newest-first;
// marginPct / -marginPct order by the sale-margin column. Margin is the only
// user-sortable column — clicking its header cycles asc → desc → default.
export const ORDER_SORTS = ['-orderDate', 'marginPct', '-marginPct'] as const;
export type OrderSortValue = (typeof ORDER_SORTS)[number];
export const DEFAULT_ORDER_SORT: OrderSortValue = '-orderDate';

export const ORDER_PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;

// Empty string in the parsers means "no filter". Date parsers store ISO date
// strings (YYYY-MM-DD) — full date-time is unnecessary; the backend coerces
// to Date at the boundary.
export const ordersFiltersParsers = {
  q: parseAsString.withDefault(''),
  status: parseAsStringEnum<OrderStatusValue>([...ORDER_STATUSES]),
  reconciliationStatus: parseAsStringEnum<ReconciliationStatusValue>([...RECONCILIATION_STATUSES]),
  costStatus: parseAsStringEnum<CostStatusValue>([...COST_STATUSES]).withDefault('calculated'),
  from: parseAsString.withDefault(''),
  to: parseAsString.withDefault(''),
  sort: parseAsStringEnum<OrderSortValue>([...ORDER_SORTS]).withDefault(DEFAULT_ORDER_SORT),
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(25),
};

export interface OrdersFilters {
  q: string;
  status: OrderStatusValue | null;
  reconciliationStatus: ReconciliationStatusValue | null;
  costStatus: CostStatusValue;
  from: string;
  to: string;
  sort: OrderSortValue;
  page: number;
  perPage: number;
}

// TanStack column id for the margin column. Sorting is server-driven, so the
// id only round-trips between the URL sort value and the header's sort arrow.
export const MARGIN_COLUMN_ID = 'saleMarginPct';

/**
 * Map the wire sort value to TanStack's SortingState so the margin header shows
 * the right arrow. The default (`-orderDate`) has no sortable column, so it maps
 * to an empty state (no arrow on any column).
 */
export function orderSortToTanstack(sort: OrderSortValue): SortingState {
  if (sort === 'marginPct') return [{ id: MARGIN_COLUMN_ID, desc: false }];
  if (sort === '-marginPct') return [{ id: MARGIN_COLUMN_ID, desc: true }];
  return [];
}

/**
 * Map a TanStack SortingState back to the wire sort value. Only the margin
 * column is sortable; clearing the sort (or any unknown column) falls back to
 * the default newest-first order.
 */
export function tanstackToOrderSort(state: SortingState): OrderSortValue {
  const head = state[0];
  if (head === undefined || head.id !== MARGIN_COLUMN_ID) return DEFAULT_ORDER_SORT;
  return head.desc ? '-marginPct' : 'marginPct';
}
