import { describe, expect, it, vi } from 'vitest';

import { PeriodTabs, type PeriodTabOption } from '@/features/campaigns/components/period-tabs';

import { render, screen } from '../helpers/render';

const OPTIONS: PeriodTabOption[] = [
  { value: '3d', dayLabel: '3 Gün', rangeLabel: '7 Tem – 10 Tem', tone: 'success' },
  { value: '4d', dayLabel: '4 Gün', rangeLabel: '10 Tem – 14 Tem', tone: 'info' },
];

describe('PeriodTabs', () => {
  it('renders each period as a two-line tab (day label + date range) with the active one selected', () => {
    render(
      <PeriodTabs value="3d" onValueChange={vi.fn()} options={OPTIONS} aria-label="Dönemler" />,
    );
    expect(screen.getByRole('tablist', { name: 'Dönemler' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    // Two-line content: bold day count + muted range.
    expect(screen.getByText('3 Gün')).toBeInTheDocument();
    expect(screen.getByText('7 Tem – 10 Tem')).toBeInTheDocument();
    // The active tab reflects `value`.
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('3 Gün');
  });

  it('reports the newly selected period on click', async () => {
    const onValueChange = vi.fn();
    const { user } = render(
      <PeriodTabs
        value="3d"
        onValueChange={onValueChange}
        options={OPTIONS}
        aria-label="Dönemler"
      />,
    );
    await user.click(screen.getByRole('tab', { name: /4 Gün/ }));
    expect(onValueChange).toHaveBeenCalledWith('4d');
  });

  it('omits the sub-line when there is no range label', () => {
    render(
      <PeriodTabs
        value="w"
        onValueChange={vi.fn()}
        options={[{ value: 'w', dayLabel: '1–7 Tem', rangeLabel: '', tone: 'neutral' }]}
        aria-label="Dönemler"
      />,
    );
    expect(screen.getByRole('tab')).toHaveTextContent('1–7 Tem');
  });
});
