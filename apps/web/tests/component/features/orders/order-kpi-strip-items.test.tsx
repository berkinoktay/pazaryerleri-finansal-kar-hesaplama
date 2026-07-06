import { useTranslations } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { StatStrip } from '@/components/patterns/stat-strip';
import type { OrderDetail } from '@/features/orders/api/get-order.api';
import { buildOrderKpiStripItems } from '@/features/orders/lib/order-kpi-strip-items';

import { render, screen } from '../../../helpers/render';

// The exact OrderDetail subset the helper reads (mirrors OrderKpiGrid). Kept in
// lockstep with order-kpi-grid.test.tsx so both KPI surfaces assert the same
// backend-served contract — the page path (this strip) and the modal path (grid).
type KpiOrder = Parameters<typeof buildOrderKpiStripItems>[0];

function makeBreakdown(saleMarginPct: string | null): OrderDetail['profitBreakdown'] {
  return {
    listGross: '200.00',
    sellerDiscountGross: '0.00',
    saleGross: '200.00',
    saleVat: '33.33',
    costGross: '100.00',
    costVat: '16.67',
    commissionGross: '20.00',
    commissionVat: '3.33',
    shippingGross: '0.00',
    shippingVat: '0.00',
    outboundShippingGross: '0.00',
    outboundShippingVat: '0.00',
    returnShippingGross: '0.00',
    returnShippingVat: '0.00',
    platformServiceGross: '0.00',
    platformServiceVat: '0.00',
    internationalServiceGross: '0.00',
    internationalServiceVat: '0.00',
    overseasReturnOperationGross: '0.00',
    overseasReturnOperationVat: '0.00',
    stoppage: '0.00',
    netVat: '13.33',
    netProfit: '31.00',
    saleMarginPct,
    costMarkupPct: null,
  };
}

function makeOrder(overrides: Partial<KpiOrder> = {}): KpiOrder {
  return {
    saleGross: '200.00',
    estimatedNetProfit: '31.00',
    settledNetProfit: null,
    reconciliationStatus: 'NOT_SETTLED',
    profitBreakdown: makeBreakdown('15.5'),
    ...overrides,
  };
}

// Renders the strip exactly as the page-path PageHeader summary slot does, so
// the assertions cover the real composition (helper → bare StatStrip).
function Strip({ order }: { order: KpiOrder }): React.ReactElement {
  const t = useTranslations('orderDetail.kpis');
  return <StatStrip surface="bare" size="md" items={buildOrderKpiStripItems(order, t)} />;
}

// "Kısmi mutabakat" and "mutabakat satırı işlenmedi" distinguish the two
// unsettled contexts (from the orderDetail.kpis.settledNetProfit copy); the em
// dash marks a null margin.
const PARTIAL_CONTEXT = /Kısmi mutabakat/;
const PENDING_CONTEXT = /mutabakat satırı işlenmedi/;

describe('buildOrderKpiStripItems', () => {
  it('renders all four KPI labels', () => {
    render(<Strip order={makeOrder()} />);
    expect(screen.getByText('Satış (KDV dahil)')).toBeInTheDocument();
    expect(screen.getByText('Tahmini kâr')).toBeInTheDocument();
    expect(screen.getByText('Fiili kâr')).toBeInTheDocument();
    expect(screen.getByText('Kâr marjı')).toBeInTheDocument();
  });

  it('renders the backend-served margin verbatim (no render-time computation)', () => {
    // Served 99.9% is kept independent of the 31/200 net/sale ratio so a
    // frontend derivation (which would print 15.5%) is provably absent.
    render(<Strip order={makeOrder({ profitBreakdown: makeBreakdown('99.9') })} />);
    expect(screen.getByText('%99,90')).toBeInTheDocument();
    expect(screen.queryByText('%15,50')).not.toBeInTheDocument();
  });

  it('shows an em dash when the served margin is null', () => {
    render(<Strip order={makeOrder({ profitBreakdown: makeBreakdown(null) })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('handles a profit-excluded order with no breakdown: em-dash margin, all tiles intact', () => {
    // Mirrors order-kpi-grid.test.tsx's profit-excluded case: profitBreakdown null
    // exercises both fallback branches (netSaleGross -> order.saleGross,
    // saleMarginPct -> null). The margin reads an em dash and every tile still
    // renders — the helper handles the null breakdown without a frontend derivation.
    render(<Strip order={makeOrder({ profitBreakdown: null })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Satış (KDV dahil)')).toBeInTheDocument();
    expect(screen.getByText('Tahmini kâr')).toBeInTheDocument();
    expect(screen.getByText('Fiili kâr')).toBeInTheDocument();
    expect(screen.getByText('Kâr marjı')).toBeInTheDocument();
  });

  it('shows the pending context when nothing is settled yet', () => {
    render(
      <Strip order={makeOrder({ settledNetProfit: null, reconciliationStatus: 'NOT_SETTLED' })} />,
    );
    expect(screen.getByText(PENDING_CONTEXT)).toBeInTheDocument();
  });

  it('shows the partial context when reconciliation is partially settled', () => {
    render(
      <Strip
        order={makeOrder({ settledNetProfit: null, reconciliationStatus: 'PARTIALLY_SETTLED' })}
      />,
    );
    expect(screen.getByText(PARTIAL_CONTEXT)).toBeInTheDocument();
  });
});
