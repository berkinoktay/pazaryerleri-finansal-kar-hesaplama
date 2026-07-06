import { describe, expect, it } from 'vitest';

import type { OrderSummary } from '@/features/orders/api/get-orders-summary.api';
import { OrdersKpiStrip } from '@/features/orders/components/orders-kpi-strip';

import trMessages from '../../messages/tr.json';
import { render, screen } from '../helpers/render';

// Turkish copy is referenced through the message catalog (not inline literals)
// so this source file stays ASCII. The em-dash is the null-margin sentinel.
const kpis = trMessages.ordersPage.kpis;
const loadingLabel = trMessages.common.loading;
const EM_DASH = String.fromCharCode(0x2014);

const SUMMARY: OrderSummary = {
  totalRevenueGross: '720',
  netProfitGross: '80',
  avgMarginPct: '11.11',
  lossOrderRate: { lossCount: 1, totalCount: 3, pct: '33.33' },
};

describe('OrdersKpiStrip', () => {
  it('renders all four KPI labels from the summary', () => {
    render(<OrdersKpiStrip summary={SUMMARY} />);

    expect(screen.getByText(kpis.revenue)).toBeInTheDocument();
    expect(screen.getByText(kpis.netProfit)).toBeInTheDocument();
    expect(screen.getByText(kpis.avgMargin)).toBeInTheDocument();
    expect(screen.getByText(kpis.lossRate)).toBeInTheDocument();
  });

  it('renders the loss-rate context as "lossCount/totalCount"', () => {
    render(<OrdersKpiStrip summary={SUMMARY} />);

    expect(screen.getByText(/1\/3/)).toBeInTheDocument();
  });

  it('shows an em-dash for a null average margin instead of a zero percentage', () => {
    render(<OrdersKpiStrip summary={{ ...SUMMARY, avgMarginPct: null }} />);

    expect(screen.getByText(EM_DASH)).toBeInTheDocument();
  });

  it('keeps the labels and exposes an accessible loading region while loading', () => {
    render(<OrdersKpiStrip loading />);

    expect(screen.getByText(kpis.revenue)).toBeInTheDocument();
    expect(screen.getByText(kpis.lossRate)).toBeInTheDocument();
    expect(screen.getByRole('status', { name: loadingLabel })).toBeInTheDocument();
  });
});
