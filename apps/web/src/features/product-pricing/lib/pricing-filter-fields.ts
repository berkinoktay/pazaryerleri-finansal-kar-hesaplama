import { rangeBounds, type FilterRow } from '@/lib/advanced-filter';

// Stable field keys for the pricing advanced-filter catalog. The catalog with
// localized labels + facet-driven options lives in usePricingFilterFields()
// (a hook, needs next-intl + facet data); these keys are the contract the
// adapters below map to/from URL params.
export const PRICING_FILTER_FIELDS = {
  category: 'category',
  brand: 'brand',
  margin: 'margin',
  lossOnly: 'lossOnly',
} as const;

// The slice of the pricing URL params the advanced-filter chips own. The URL
// keeps its readable individual params (?brandId=…&marginMin=…) — chips are
// DERIVED state, adapted both ways below. q / sortBy / pagination stay outside
// the chip system.
export interface PricingAdvancedParams {
  categoryId: string;
  brandId: string;
  marginMin: string;
  marginMax: string;
  lossOnly: boolean;
}

/**
 * URL params → FilterRow[] for the toolbar's `advancedFilter.value`. Row ids
 * are the field keys (each dimension appears at most once). The margin
 * operator mirrors which bounds are present so the chip summary reads
 * naturally (`≥ %10` vs `%10 – %40`).
 */
export function pricingFilterRowsFromParams(params: PricingAdvancedParams): FilterRow[] {
  const rows: FilterRow[] = [];
  if (params.categoryId.length > 0) {
    rows.push({
      id: PRICING_FILTER_FIELDS.category,
      field: PRICING_FILTER_FIELDS.category,
      operator: 'eq',
      value: params.categoryId,
    });
  }
  if (params.brandId.length > 0) {
    rows.push({
      id: PRICING_FILTER_FIELDS.brand,
      field: PRICING_FILTER_FIELDS.brand,
      operator: 'eq',
      value: params.brandId,
    });
  }
  const hasMin = params.marginMin.length > 0;
  const hasMax = params.marginMax.length > 0;
  if (hasMin || hasMax) {
    rows.push({
      id: PRICING_FILTER_FIELDS.margin,
      field: PRICING_FILTER_FIELDS.margin,
      operator: hasMin && hasMax ? 'between' : hasMin ? 'gte' : 'lte',
      value:
        hasMin && hasMax
          ? [params.marginMin, params.marginMax]
          : hasMin
            ? params.marginMin
            : params.marginMax,
    });
  }
  if (params.lossOnly) {
    rows.push({
      id: PRICING_FILTER_FIELDS.lossOnly,
      field: PRICING_FILTER_FIELDS.lossOnly,
      operator: 'isTrue',
      value: '',
    });
  }
  return rows;
}

/**
 * FilterRow[] → URL params for `onApply`. Every dimension is emitted
 * explicitly (empty string / false when its row is absent) so removing a
 * chip clears the matching param.
 */
export function pricingFilterParamsFromRows(rows: FilterRow[]): PricingAdvancedParams {
  const params: PricingAdvancedParams = {
    categoryId: '',
    brandId: '',
    marginMin: '',
    marginMax: '',
    lossOnly: false,
  };
  for (const filterRow of rows) {
    const scalar = Array.isArray(filterRow.value) ? filterRow.value[0] : filterRow.value;
    switch (filterRow.field) {
      case PRICING_FILTER_FIELDS.category:
        if (scalar !== undefined) params.categoryId = scalar;
        break;
      case PRICING_FILTER_FIELDS.brand:
        if (scalar !== undefined) params.brandId = scalar;
        break;
      case PRICING_FILTER_FIELDS.margin: {
        const [min, max] = rangeBounds(filterRow);
        if (min !== undefined) params.marginMin = min;
        if (max !== undefined) params.marginMax = max;
        break;
      }
      case PRICING_FILTER_FIELDS.lossOnly:
        params.lossOnly = filterRow.operator === 'isTrue';
        break;
    }
  }
  return params;
}
