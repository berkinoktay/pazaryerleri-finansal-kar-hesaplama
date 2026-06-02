import { describe, expect, it, vi } from 'vitest';

import { StatCard } from '@/components/patterns/stat-card';

import { render, screen } from '../helpers/render';

describe('<StatCard> states', () => {
  it('renders the label and value when ready', () => {
    render(<StatCard label="Net Kâr" value="₺82.906" />);
    expect(screen.getByText('Net Kâr')).toBeInTheDocument();
    expect(screen.getByText('₺82.906')).toBeInTheDocument();
  });

  it('swaps the value for a busy skeleton while loading', () => {
    render(<StatCard label="Net Kâr" value="₺82.906" status="loading" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('₺82.906')).not.toBeInTheDocument();
  });

  it('renders an em dash and hides the delta when empty', () => {
    render(
      <StatCard
        label="Net Kâr"
        value="₺82.906"
        status="empty"
        delta={{ percent: 18, goodDirection: 'up' }}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('₺82.906')).not.toBeInTheDocument();
  });

  it('shows an error block and fires onRetry', async () => {
    const onRetry = vi.fn();
    const { user } = render(
      <StatCard label="Net Kâr" value="x" status="error" onRetry={onRetry} />,
    );
    expect(screen.getByText('Yüklenemedi')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yenile' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('<StatCard> composition', () => {
  it('renders the delta period phrase', () => {
    render(
      <StatCard
        label="Ciro"
        value="₺96.850"
        delta={{ percent: 18, goodDirection: 'up', period: 'geçen haftaya göre' }}
      />,
    );
    expect(screen.getByText('geçen haftaya göre')).toBeInTheDocument();
  });

  it('renders the context sub-line', () => {
    render(<StatCard label="Sipariş" value="1.472" context="Nisan 1-17" />);
    expect(screen.getByText('Nisan 1-17')).toBeInTheDocument();
  });

  it('exposes the hint via an info button named after the label', () => {
    render(<StatCard label="Net Kâr" value="x" hint="Gerçek kazanç." />);
    expect(screen.getByRole('button', { name: 'Net Kâr' })).toBeInTheDocument();
  });

  it('fires the drill-down handler when the whole card is clicked', async () => {
    const onClick = vi.fn();
    const { user } = render(
      <StatCard label="Bekleyen Tahsilat" value="₺74.120" onClick={onClick} />,
    );
    await user.click(screen.getByRole('button', { name: 'Bekleyen Tahsilat' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('keeps the action clickable above the drill-down overlay', async () => {
    const onClick = vi.fn();
    const onAction = vi.fn();
    const { user } = render(
      <StatCard
        label="Haftalık Satış"
        value="₺4.587"
        onClick={onClick}
        action={
          <button type="button" onClick={onAction}>
            Raporu gör
          </button>
        }
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Raporu gör' }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not trigger drill-down when the hint is clicked', async () => {
    const onClick = vi.fn();
    const { user } = render(
      <StatCard
        label="Net Kâr"
        value="x"
        hint="Gerçek kazanç."
        onClick={onClick}
        drillLabel="Detaya git"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Net Kâr' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
