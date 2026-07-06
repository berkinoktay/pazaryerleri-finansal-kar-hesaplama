import { describe, expect, it } from 'vitest';

import type { LivePerformanceKpis } from '@/features/live-performance/api/get-live-kpis.api';
import { LiveHeroCaption } from '@/features/live-performance/components/live-hero-caption';

import trMessages from '../../../../messages/tr.json';
import { render, screen } from '../../../helpers/render';

// Turkish copy is referenced through the message catalog (not inline literals)
// so this source file stays ASCII; numeric/format assertions are ASCII already.
const yesterdayLabel = trMessages.livePerformance.chart.yesterdayLabel;
const netProfitLabel = trMessages.livePerformance.kpis.netProfit;

// A full LivePerformanceKpis fixture; each test overrides only the fields the
// caption reads (net profit today/yesterday + pending order count).
const BASE: LivePerformanceKpis = {
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
  pendingOrderCountToday: 0,
};

describe('LiveHeroCaption', () => {
  it('renders the today-vs-yesterday delta chip as a positive change when today beats yesterday', () => {
    // (20 - 15) / 15 = +33.3%
    render(
      <LiveHeroCaption kpis={{ ...BASE, netProfitToday: '20.00', netProfitYesterday: '15.00' }} />,
    );

    expect(screen.getByText('+%33,3')).toBeInTheDocument();
  });

  it('shows the yesterday label and its figure for context', () => {
    render(<LiveHeroCaption kpis={{ ...BASE, netProfitYesterday: '15.00' }} />);

    expect(screen.getByText(yesterdayLabel)).toBeInTheDocument();
    expect(screen.getByText(/15,00/)).toBeInTheDocument();
  });

  it('carries the estimate info hint, labelled with the net-profit KPI name', () => {
    render(<LiveHeroCaption kpis={BASE} />);

    // The InfoHint trigger's accessible name is the net-profit KPI label.
    expect(screen.getByRole('button', { name: netProfitLabel })).toBeInTheDocument();
  });

  it('omits the pending-cost sub-label when no orders await cost', () => {
    render(<LiveHeroCaption kpis={{ ...BASE, pendingOrderCountToday: 0 }} />);

    expect(screen.queryByText(/maliyet bekliyor/)).toBeNull();
  });

  it('shows the pending-cost sub-label with the pending order count when orders await cost', () => {
    render(<LiveHeroCaption kpis={{ ...BASE, pendingOrderCountToday: 3 }} />);

    const pending = screen.getByText(/maliyet bekliyor/);
    expect(pending).toHaveTextContent('3');
  });

  it('omits the delta chip when yesterday was zero (relative change is undefined)', () => {
    // computeDeltaPercent returns null for a zero base, so no percent chip renders;
    // the caption still shows the yesterday figure without a trend chip.
    render(
      <LiveHeroCaption kpis={{ ...BASE, netProfitToday: '20.00', netProfitYesterday: '0.00' }} />,
    );

    expect(screen.getByText(yesterdayLabel)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
  });
});
