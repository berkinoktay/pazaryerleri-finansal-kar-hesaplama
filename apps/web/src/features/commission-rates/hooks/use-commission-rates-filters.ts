'use client';

import { parseAsString, parseAsStringEnum, useQueryStates, type Values } from 'nuqs';

import type {
  CommissionRateProductScope,
  CommissionRateRuleKind,
  CommissionRateSort,
} from '../query-keys';

export const COMMISSION_RATE_RULE_KINDS: readonly CommissionRateRuleKind[] = [
  'CATEGORY',
  'CATEGORY_BRAND',
];
export const COMMISSION_RATE_PRODUCT_SCOPES: readonly CommissionRateProductScope[] = [
  'all',
  'active',
];
export const COMMISSION_RATE_SORTS: readonly CommissionRateSort[] = [
  'category_name:asc',
  'base_rate:asc',
  'base_rate:desc',
  'product_count:desc',
];

export const commissionRatesFiltersParsers = {
  ruleKind: parseAsStringEnum<CommissionRateRuleKind>([...COMMISSION_RATE_RULE_KINDS]).withDefault(
    'CATEGORY',
  ),
  productScope: parseAsStringEnum<CommissionRateProductScope>([
    ...COMMISSION_RATE_PRODUCT_SCOPES,
  ]).withDefault('all'),
  q: parseAsString.withDefault(''),
  sort: parseAsStringEnum<CommissionRateSort>([...COMMISSION_RATE_SORTS]).withDefault(
    'category_name:asc',
  ),
};

export type CommissionRatesFilters = Values<typeof commissionRatesFiltersParsers>;
type FiltersUpdater = Partial<CommissionRatesFilters>;

/**
 * URL ↔ filter state binding via nuqs. Every filter change generates a
 * new React Query key (cursor is owned by useInfiniteQuery via
 * pageParam, not stored here) so list pages reset automatically.
 *
 * Crucially: switching `sort` to 'product_count:desc' MUST happen in a
 * single setFilters call together with productScope='active' to honor
 * the backend's INVALID_SORT_FOR_SCOPE invariant. The auto-switch
 * helper in lib/sort-options.ts computes the safe pair; the table's
 * sort handler invokes it before calling setFilters.
 */
export function useCommissionRatesFilters(): {
  filters: CommissionRatesFilters;
  setFilters: (next: FiltersUpdater) => Promise<URLSearchParams>;
} {
  const [filters, setRaw] = useQueryStates(commissionRatesFiltersParsers, { history: 'push' });
  return { filters, setFilters: setRaw };
}
