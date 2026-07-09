import { describe, expect, it } from 'vitest';

import type { components } from '@pazarsync/api-client';

import { CHART_POSITIVE } from '@/components/patterns/chart-colors';
import { buildProfitAllocation } from '@/lib/build-profit-allocation';

type ProfitBreakdownData = NonNullable<components['schemas']['ProfitBreakdown']>;

// A 2-item order's grouped totals (backend-served): the four groups sum to
// saleGross. Each test overrides what it exercises.
function makeBreakdown(overrides: Partial<ProfitBreakdownData> = {}): ProfitBreakdownData {
  return {
    listGross: '1159.70',
    sellerDiscountGross: '150.00',
    saleGross: '1009.70',
    saleVat: '168.28',
    costGross: '407.00',
    costVat: '67.83',
    commissionGross: '201.23',
    commissionVat: '33.54',
    shippingGross: '54.99',
    shippingVat: '9.16',
    outboundShippingGross: '54.99',
    outboundShippingVat: '9.16',
    returnShippingGross: '0.00',
    returnShippingVat: '0.00',
    platformServiceGross: '10.19',
    platformServiceVat: '1.70',
    internationalServiceGross: '0.00',
    internationalServiceVat: '0.00',
    overseasReturnOperationGross: '0.00',
    overseasReturnOperationVat: '0.00',
    stoppage: '8.41',
    netVat: '56.05',
    netProfit: '271.83',
    saleMarginPct: '26.92',
    costMarkupPct: '66.79',
    marketplaceFeesGross: '266.41',
    taxesGross: '64.46',
    totalDeductionsGross: '737.87',
    ...overrides,
  };
}

describe('buildProfitAllocation', () => {
  it('returns the four groups in order, reading backend group totals verbatim', () => {
    const { segments } = buildProfitAllocation(makeBreakdown());
    expect(segments.map((s) => s.key)).toEqual(['cost', 'marketplace', 'taxes', 'profit']);
    expect(segments.map((s) => s.amount)).toEqual(['407.00', '266.41', '64.46', '271.83']);
  });

  it('derives each group share as amount / saleGross (presentation ratio)', () => {
    const byKey = Object.fromEntries(
      buildProfitAllocation(makeBreakdown()).segments.map((s) => [s.key, s.percent]),
    );
    expect(byKey.cost).toBeCloseTo(40.31, 1);
    expect(byKey.profit).toBeCloseTo(26.92, 1);
  });

  it('colors the profit group with the positive chart token', () => {
    const profit = buildProfitAllocation(makeBreakdown()).segments.at(-1);
    expect(profit?.key).toBe('profit');
    expect(profit?.color).toBe(CHART_POSITIVE);
  });

  it('renders the bar for a clean composition but not on a loss', () => {
    expect(buildProfitAllocation(makeBreakdown()).barRenderable).toBe(true);
    expect(buildProfitAllocation(makeBreakdown({ netProfit: '-20.00' })).barRenderable).toBe(false);
    expect(buildProfitAllocation(makeBreakdown({ taxesGross: '-5.00' })).barRenderable).toBe(false);
    expect(buildProfitAllocation(makeBreakdown({ saleGross: '0.00' })).barRenderable).toBe(false);
  });
});
