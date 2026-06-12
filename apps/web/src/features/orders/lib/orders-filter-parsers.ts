import { parseAsInteger, parseAsString, parseAsStringEnum } from 'nuqs';

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
  page: number;
  perPage: number;
}
