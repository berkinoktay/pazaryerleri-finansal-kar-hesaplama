import { describe, expect, it } from 'vitest';

import type { OrderDetail } from '@/features/orders/api/get-order.api';
import { OrderKpiGrid, type OrderKpiGridProps } from '@/features/orders/components/order-kpi-grid';

import { render, screen } from '../helpers/render';

// OrderKpiGrid yalnız bu alt kümeyi okur (Pick). Marj backend'de hesaplanıp
// profitBreakdown.saleMarginPct olarak servis edilir; frontend SADECE render eder.
type KpiOrder = OrderKpiGridProps['order'];

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
    returnScenarioNetProfit: null,
    returnScenarioMarginPct: null,
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

describe('OrderKpiGrid', () => {
  it('renders the backend-served margin verbatim (no render-time computation)', () => {
    // Served marj 15.5% — frontend HESAPLASAYDI (31/200×100 = 15.5) tesadüfen
    // eşleşmesin diye servis değeri kasten bağımsız tutulur: 99.9% verince
    // frontend'in türetme YAPMADIĞI kanıtlanır (türetme 15.5 üretirdi).
    render(<OrderKpiGrid order={makeOrder({ profitBreakdown: makeBreakdown('99.9') })} />);
    expect(screen.getByText('%99,90')).toBeInTheDocument();
    expect(screen.queryByText('%15,50')).not.toBeInTheDocument();
  });

  it('shows an em dash when the served margin is null (sale gross 0)', () => {
    render(
      <OrderKpiGrid order={makeOrder({ saleGross: null, profitBreakdown: makeBreakdown(null) })} />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows an em dash when there is no breakdown at all (profit-excluded)', () => {
    render(<OrderKpiGrid order={makeOrder({ profitBreakdown: null })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
