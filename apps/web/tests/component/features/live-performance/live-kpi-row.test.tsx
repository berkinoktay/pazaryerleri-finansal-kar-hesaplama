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
  it('renders the five satellite KPIs — net profit is the framed header hero, so it is absent here', async () => {
    server.use(http.get(URL, () => HttpResponse.json(KPIS)));

    render(<LiveKpiRow orgId={ORG_ID} storeId={STORE_ID} />);

    await waitFor(() => expect(screen.getByText('Toplam Ciro')).toBeInTheDocument());
    expect(screen.getByText('Net Sipariş Adedi')).toBeInTheDocument();
    expect(screen.getByText('Net Satış Adedi')).toBeInTheDocument();
    expect(screen.getByText('Kâr Marjı')).toBeInTheDocument();
    expect(screen.getByText('Kâr/Maliyet Oranı')).toBeInTheDocument();
    // Net profit ("Kâr Tutarı") is now the header hero — it must NOT be a satellite.
    expect(screen.queryByText('Kâr Tutarı')).toBeNull();
  });

  it('keeps the real satellite labels visible while the strip is loading', async () => {
    server.use(http.get(URL, () => HttpResponse.json(KPIS)));

    render(<LiveKpiRow orgId={ORG_ID} storeId={STORE_ID} />);

    // The first render is pending: StatStrip's loading mode keeps the static
    // labels (config-driven) and exposes an accessible busy region.
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Toplam Ciro')).toBeInTheDocument();

    // Let the query settle so React has no pending work after the test.
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('carries the estimate ⓘ only on the profit-quality satellites (margin + ratio)', async () => {
    server.use(http.get(URL, () => HttpResponse.json(KPIS)));

    render(<LiveKpiRow orgId={ORG_ID} storeId={STORE_ID} />);

    await waitFor(() => expect(screen.getByText('Kâr Marjı')).toBeInTheDocument());
    // The InfoHint trigger's accessible name is its satellite label.
    expect(screen.getByRole('button', { name: 'Kâr Marjı' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kâr/Maliyet Oranı' })).toBeInTheDocument();
    // Volume satellites carry no estimate note.
    expect(screen.queryByRole('button', { name: 'Toplam Ciro' })).toBeNull();
  });

  it('never renders the pending-cost sub-label — it moved to the header hero with net profit', async () => {
    // KPIS carries pendingOrderCountToday: 1, which used to light up a
    // "1 sipariş maliyet bekliyor" sub-label on the (now-removed) net-profit card.
    server.use(http.get(URL, () => HttpResponse.json(KPIS)));

    render(<LiveKpiRow orgId={ORG_ID} storeId={STORE_ID} />);

    await waitFor(() => expect(screen.getByText('Kâr Marjı')).toBeInTheDocument());
    expect(screen.queryByText(/maliyet bekliyor/)).toBeNull();
  });

  it('OFF state (no MarginColoringProvider): the loaded margin value carries no inline color — default foreground, matching the pre-margin-coloring StatCard', async () => {
    // The margin-coloring feature tints the VALUE via an inline `color` style
    // (marginColorStyle), NOT a tone class, and only when the preference is on.
    // With no provider, useMarginColoring() is null -> marginColorStyle returns
    // undefined -> the value renders colorless. We wait for the query to SETTLE
    // (StatStrip drops its role="status" region) before asserting: while pending
    // the value span does not exist, so the old assert-on-loading-DOM check
    // pinned nothing. And had that old check waited, the loaded margin cell's
    // legitimate green TrendDelta chip (text-success, an unrelated trend signal)
    // would have false-failed its "no text-success class" assertion.
    server.use(http.get(URL, () => HttpResponse.json(KPIS)));

    render(<LiveKpiRow orgId={ORG_ID} storeId={STORE_ID} />);

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());

    // Walk up from the label span to its StatStrip cell: label span -> label-row
    // div -> cell div. The cell holds the label row, the value span, and the
    // delta line. In the OFF state NO span in the cell carries an inline color;
    // a value colored regardless of preference would surface one here.
    const cell = screen.getByText('Kâr Marjı').closest('div')?.parentElement;
    expect(cell).toBeTruthy();
    const coloredSpans = Array.from(cell!.querySelectorAll('span')).filter(
      (span) => span.style.color !== '',
    );
    expect(coloredSpans).toHaveLength(0);
  });
});
