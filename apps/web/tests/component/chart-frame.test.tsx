import { describe, expect, it, vi } from 'vitest';

import { ChartFrame } from '@/components/patterns/chart-frame';

import { render, screen } from '../helpers/render';

// A stand-in for the recharts plot — recharts itself doesn't lay out in
// happy-dom (see sparkline.test), so we assert the FRAME's state machine
// around an inert child rather than the SVG internals.
const PLOT = <div data-testid="plot">plot</div>;

describe('<ChartFrame> states', () => {
  it('renders the plot and title when ready (default)', () => {
    render(<ChartFrame title="Net Kâr">{PLOT}</ChartFrame>);
    expect(screen.getByTestId('plot')).toBeInTheDocument();
    expect(screen.getByText('Net Kâr')).toBeInTheDocument();
  });

  it('keeps the plot (its own empty frame) and overlays a hint when empty — not a CTA', () => {
    render(
      <ChartFrame title="Net Kâr" status="empty">
        {PLOT}
      </ChartFrame>,
    );
    // The plot stays (a LineChart renders its OWN empty axes/labels there)…
    expect(screen.getByTestId('plot')).toBeInTheDocument();
    // …with a quiet hint over it, and no action button.
    expect(screen.getByText('Bu dönemde veri yok')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('swaps the plot for an animated chart skeleton while loading', () => {
    render(
      <ChartFrame title="Net Kâr" status="loading">
        {PLOT}
      </ChartFrame>,
    );
    expect(screen.queryByTestId('plot')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows an error block and fires onRetry', async () => {
    const onRetry = vi.fn();
    const { user } = render(
      <ChartFrame title="Net Kâr" status="error" onRetry={onRetry}>
        {PLOT}
      </ChartFrame>,
    );
    expect(screen.queryByTestId('plot')).not.toBeInTheDocument();
    expect(screen.getByText('Veriler yüklenemedi')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders the headline value node', () => {
    render(
      <ChartFrame title="Net Kâr" value={<span>₺48.120</span>} delta={{ percent: 8.5 }}>
        {PLOT}
      </ChartFrame>,
    );
    expect(screen.getByText('₺48.120')).toBeInTheDocument();
  });

  it('renders the context sub-line and an inline legend', () => {
    render(
      <ChartFrame
        title="Net Kâr"
        context="Dün aynı saatte ₺690"
        legend={[
          { label: 'Bugün', value: '₺644', swatch: 'var(--color-chart-positive)' },
          { label: 'Dün', value: '₺690', swatch: 'var(--color-muted-foreground)', reference: true },
        ]}
      >
        {PLOT}
      </ChartFrame>,
    );
    expect(screen.getByText('Dün aynı saatte ₺690')).toBeInTheDocument();
    expect(screen.getByText('Bugün')).toBeInTheDocument();
    expect(screen.getByText('₺644')).toBeInTheDocument();
  });

  it('metric tabs replace the title and report the chosen metric', async () => {
    const onValueChange = vi.fn();
    const { user } = render(
      <ChartFrame
        title="Net Kâr"
        metricTabs={{
          value: 'netKar',
          options: [
            { value: 'netKar', label: 'Net Kâr' },
            { value: 'ciro', label: 'Ciro' },
          ],
          onValueChange,
        }}
      >
        {PLOT}
      </ChartFrame>,
    );
    await user.click(screen.getByText('Ciro'));
    expect(onValueChange).toHaveBeenCalledWith('ciro');
  });

  it('renders a period selector and reports the chosen period', async () => {
    const onValueChange = vi.fn();
    const { user } = render(
      <ChartFrame
        title="Net Kâr"
        period={{
          value: '7d',
          options: [
            { value: '7d', label: '7G' },
            { value: '30d', label: '30G' },
          ],
          onValueChange,
        }}
      >
        {PLOT}
      </ChartFrame>,
    );
    await user.click(screen.getByText('30G'));
    expect(onValueChange).toHaveBeenCalledWith('30d');
  });
});
