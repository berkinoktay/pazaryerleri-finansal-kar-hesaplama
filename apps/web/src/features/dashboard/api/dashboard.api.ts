import Decimal from 'decimal.js';

import type { PeriodKey } from '@/features/dashboard/components/period-preset-list';

export interface DashboardKpis {
  revenue: Decimal;
  costedRevenue: Decimal;
  netProfit: Decimal;
  profitMarginPercent: number;
  returnCount: number;
  // YoY/PoP deltas in percent
  revenueDelta: number;
  costedRevenueDelta: number;
  netProfitDelta: number;
  profitMarginDeltaPoints: number;
  returnDelta: number;
}

export interface CostBreakdownEntry {
  key: 'product' | 'commission' | 'shipping' | 'service' | 'intl' | 'withholding' | 'vat' | 'other';
  amount: Decimal;
}

export interface DashboardTrendPoint {
  date: string; // ISO date
  profit: Decimal;
}

export interface FunnelStep {
  key: 'revenue' | 'minus-shipping' | 'minus-marketplace' | 'minus-cost' | 'net';
  amount: Decimal;
}

export interface ProductMetrics {
  netSales: number;
  avgProfit: Decimal;
  avgShippingCost: Decimal;
  avgCommissionPercent: number;
  avgDiscountPercent: number;
}

export interface OrderMetrics {
  count: number;
  avgOrderValue: Decimal;
  avgProfit: Decimal;
}

export interface ProductPerformance {
  id: string;
  name: string;
  delta: Decimal; // signed
}

export interface DashboardMetrics {
  kpis: DashboardKpis;
  costBreakdown: readonly CostBreakdownEntry[];
  profitTrend: readonly DashboardTrendPoint[];
  funnel: readonly FunnelStep[];
  productMetrics: ProductMetrics;
  orderMetrics: OrderMetrics;
  topProfitable: readonly ProductPerformance[];
  topLossy: readonly ProductPerformance[];
}

export interface DashboardMetricsParams {
  orgId: string;
  storeId: string;
  period: PeriodKey;
}

// MOCK — replace with apiClient.GET when backend endpoint ships.
export async function fetchDashboardMetrics(
  _params: DashboardMetricsParams,
): Promise<DashboardMetrics> {
  await new Promise((r) => setTimeout(r, 50));
  return MOCK_METRICS;
}

const MOCK_METRICS: DashboardMetrics = {
  kpis: {
    revenue: new Decimal('284390.45'),
    costedRevenue: new Decimal('192978.26'),
    netProfit: new Decimal('48120.80'),
    profitMarginPercent: 16.9,
    returnCount: 38,
    revenueDelta: 12.4,
    costedRevenueDelta: 9.8,
    netProfitDelta: 8.1,
    profitMarginDeltaPoints: 0.4,
    returnDelta: -14.2,
  },
  costBreakdown: [
    { key: 'product', amount: new Decimal('109798.45') },
    { key: 'commission', amount: new Decimal('34631.02') },
    { key: 'shipping', amount: new Decimal('20314.67') },
    { key: 'service', amount: new Decimal('2712.18') },
    { key: 'intl', amount: new Decimal('0') },
    { key: 'withholding', amount: new Decimal('1754.51') },
    { key: 'vat', amount: new Decimal('-2048.39') },
    { key: 'other', amount: new Decimal('3000') },
  ],
  profitTrend: [
    { date: '2026-04-15', profit: new Decimal('3105') },
    { date: '2026-04-16', profit: new Decimal('5621') },
    { date: '2026-04-17', profit: new Decimal('3609') },
    { date: '2026-04-18', profit: new Decimal('3290') },
    { date: '2026-04-19', profit: new Decimal('6125') },
    { date: '2026-04-20', profit: new Decimal('4220') },
    { date: '2026-04-21', profit: new Decimal('2480') },
  ],
  funnel: [
    { key: 'revenue', amount: new Decimal('192978.26') },
    { key: 'minus-shipping', amount: new Decimal('172663.59') },
    { key: 'minus-marketplace', amount: new Decimal('135320.39') },
    { key: 'minus-cost', amount: new Decimal('90000') },
    { key: 'net', amount: new Decimal('48120.80') },
  ],
  productMetrics: {
    netSales: 282,
    avgProfit: new Decimal('91.55'),
    avgShippingCost: new Decimal('72.04'),
    avgCommissionPercent: 17.95,
    avgDiscountPercent: 0.45,
  },
  orderMetrics: {
    count: 222,
    avgOrderValue: new Decimal('869.27'),
    avgProfit: new Decimal('116.29'),
  },
  topProfitable: [
    { id: 'p1', name: 'Kablosuz kulaklık', delta: new Decimal('8420') },
    { id: 'p2', name: 'Spor çanta', delta: new Decimal('6120') },
    { id: 'p3', name: 'Mutfak robotu', delta: new Decimal('4890') },
  ],
  topLossy: [
    { id: 'p4', name: 'Telefon kılıfı', delta: new Decimal('-342') },
    { id: 'p5', name: 'USB kablo', delta: new Decimal('-128') },
  ],
};
