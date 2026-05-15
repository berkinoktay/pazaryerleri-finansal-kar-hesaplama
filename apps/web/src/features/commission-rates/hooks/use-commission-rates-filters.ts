'use client';

import {
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  useQueryStates,
  type Values,
} from 'nuqs';

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
export const COMMISSION_RATES_PER_PAGE_OPTIONS: readonly number[] = [10, 25, 50, 100];
export const COMMISSION_RATES_DEFAULT_PER_PAGE = 50;

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
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(COMMISSION_RATES_DEFAULT_PER_PAGE),
};

export type CommissionRatesFilters = Values<typeof commissionRatesFiltersParsers>;
type FiltersUpdater = Partial<CommissionRatesFilters>;

/**
 * URL ↔ filter state binding via nuqs. Any change that's not strictly
 * `page` / `perPage` resets `page` to 1 so the user never lands on an
 * empty page after narrowing the result set.
 */
export function useCommissionRatesFilters(): {
  filters: CommissionRatesFilters;
  setFilters: (next: FiltersUpdater) => Promise<URLSearchParams>;
} {
  const [filters, setRaw] = useQueryStates(commissionRatesFiltersParsers, { history: 'push' });

  const setFilters = async (next: FiltersUpdater): Promise<URLSearchParams> => {
    const touchesNonPaginationFilter =
      'ruleKind' in next ||
      'productScope' in next ||
      'q' in next ||
      'sort' in next ||
      'perPage' in next;
    return setRaw({
      ...next,
      ...(touchesNonPaginationFilter && next.page === undefined ? { page: 1 } : {}),
    });
  };

  return { filters, setFilters };
}
