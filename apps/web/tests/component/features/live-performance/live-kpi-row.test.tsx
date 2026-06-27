import { describe, expect, it } from 'vitest';

import { LiveKpiRow } from '@/features/live-performance/components/live-kpi-row';

import { render, screen, waitFor } from '../../../helpers/render';
import { server, http, HttpResponse } from '../../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const STORE_ID = '00000000-0000-0000-0000-000000000002';
const URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/live-performance/kpis`;

const KPIS = {
  revenueToday: '160.00',
  revenueYesterday: '120.00',
  orderCountToday: 2,
  orderCountYesterday: 1,
  unitsSoldToday: 5,
  unitsSoldYesterday: 3,
  netProfitToday: '20.00',
  netProfitYesterday: '15.00',
  marginToday: '20.00',
  marginYesterday: '18.75',
  profitCostRatioToday: '33.33',
  profitCostRatioYesterday: '30.00',
  pendingRevenueToday: '60.00',
  pendingOrderCountToday: 1,
};

describe('LiveKpiRow', () => {
  it('renders all six KPI cards including the new units + ratio cards', async () => {
    server.use(http.get(URL, () => HttpResponse.json(KPIS)));

    render(<LiveKpiRow orgId={ORG_ID} storeId={STORE_ID} />);

    await waitFor(() => expect(screen.getByText('Toplam Ciro')).toBeInTheDocument());
    expect(screen.getByText('Net Sipariş Adedi')).toBeInTheDocument();
    expect(screen.getByText('Net Satış Adedi')).toBeInTheDocument();
    expect(screen.getByText('Kâr Tutarı')).toBeInTheDocument();
    expect(screen.getByText('Kâr Marjı')).toBeInTheDocument();
    expect(screen.getByText('Kâr/Maliyet Oranı')).toBeInTheDocument();
  });

  it('shows the pending-cost sub-label and the estimate hint on the profit card', async () => {
    server.use(http.get(URL, () => HttpResponse.json(KPIS)));

    render(<LiveKpiRow orgId={ORG_ID} storeId={STORE_ID} />);

    // The "1 sipariş maliyet bekliyor" gap sub-label is fed by pendingOrderCountToday.
    await waitFor(() => expect(screen.getByText(/1 sipariş maliyet bekliyor/)).toBeInTheDocument());
    // The profit cards carry an ⓘ whose accessible name is the card label.
    expect(screen.getByRole('button', { name: 'Kâr Tutarı' })).toBeInTheDocument();
  });

  it('omits the pending sub-label when nothing is awaiting cost', async () => {
    server.use(http.get(URL, () => HttpResponse.json({ ...KPIS, pendingOrderCountToday: 0 })));

    render(<LiveKpiRow orgId={ORG_ID} storeId={STORE_ID} />);

    await waitFor(() => expect(screen.getByText('Kâr Tutarı')).toBeInTheDocument());
    expect(screen.queryByText(/maliyet bekliyor/)).toBeNull();
  });

  it('OFF state (no provider): margin KPI value has no text-success or text-destructive class', async () => {
    // Regression guard for the OFF-state parity invariant: when MarginColoringProvider
    // is absent (scale = null), the margin AnimatedNumber must render exactly as it did
    // before the margin-coloring feature — colorless (no binary tone class).
    server.use(http.get(URL, () => HttpResponse.json(KPIS)));

    render(<LiveKpiRow orgId={ORG_ID} storeId={STORE_ID} />);

    // Wait for the KPI data to resolve and the card heading to appear.
    await waitFor(() => expect(screen.getByText('Kâr Marjı')).toBeInTheDocument());

    // AnimatedNumber renders into a <span>. Find the span inside the margin KPI
    // card by querying the card element that contains "Kâr Marjı" and then
    // inspecting all spans inside for tone classes.
    const card =
      screen.getByText('Kâr Marjı').closest('[data-slot="card"]') ??
      screen.getByText('Kâr Marjı').closest('div');
    expect(card).toBeTruthy();
    // No element inside the margin card should carry a binary tone class.
    const allSpans = card!.querySelectorAll('span');
    for (const span of allSpans) {
      expect(span.className).not.toContain('text-success');
      expect(span.className).not.toContain('text-destructive');
    }
  });
});
