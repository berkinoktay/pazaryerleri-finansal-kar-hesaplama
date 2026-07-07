import { describe, expect, it, vi } from 'vitest';

import { ProfitBadge } from '@/components/patterns/profit-badge';
import { type MarginScale } from '@/lib/margin-coloring';

import { render, screen } from '../helpers/render';
import trMessages from '../../messages/tr.json';

const OPEN_LABEL = trMessages.profitBadge.open;

describe('ProfitBadge', () => {
  it('renders the formatted profit amount inside a button that announces it opens detail', () => {
    render(<ProfitBadge value="212.87" marginPct="19.35" scale={null} onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: OPEN_LABEL });
    expect(button).toBeInTheDocument();
    // tr-TR: '212.87' → '212,87 ₺' (comma decimal). Match the digit fragment so the
    // assertion is robust to symbol placement.
    expect(screen.getByText(/212,87/)).toBeInTheDocument();
  });

  it('opens the detail surface on click', async () => {
    const onOpen = vi.fn();
    const { user } = render(
      <ProfitBadge value="212.87" marginPct="19.35" scale={null} onOpen={onOpen} />,
    );
    await user.click(screen.getByRole('button', { name: OPEN_LABEL }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('explains what the click does in a tooltip on focus', async () => {
    render(<ProfitBadge value="212.87" marginPct="19.35" scale={null} onOpen={vi.fn()} />);
    screen.getByRole('button', { name: OPEN_LABEL }).focus();
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(trMessages.profitBadge.tooltip);
  });

  it('opens on keyboard activation (Enter) — it is a real button, not a clickable span', async () => {
    const onOpen = vi.fn();
    const { user } = render(
      <ProfitBadge value="212.87" marginPct="19.35" scale={null} onOpen={onOpen} />,
    );
    screen.getByRole('button', { name: OPEN_LABEL }).focus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders a neutral em-dash badge that is STILL clickable when the amount is null', async () => {
    // No stranding: a row with no estimate still has a trigger to open its detail.
    const onOpen = vi.fn();
    const { user } = render(
      <ProfitBadge value={null} marginPct={null} scale={null} onOpen={onOpen} />,
    );
    const button = screen.getByRole('button', { name: OPEN_LABEL });
    expect(button).toHaveTextContent('—');
    await user.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders a custom emptyLabel instead of the em-dash when the amount is null', () => {
    // A specific, actionable empty cause (e.g. "Maliyet girin") reads better than a
    // mute dash; the default stays "—" so existing surfaces are unchanged.
    render(
      <ProfitBadge
        value={null}
        marginPct={null}
        scale={null}
        onOpen={vi.fn()}
        emptyLabel="Maliyet girin"
      />,
    );
    const button = screen.getByRole('button', { name: OPEN_LABEL });
    expect(button).toHaveTextContent('Maliyet girin');
    expect(button).not.toHaveTextContent('—');
  });

  it('paints the emptyLabel empty state as a warning-soft chip (bg-warning-surface text-warning)', () => {
    // A null amount WITH a cause draws the eye as a warning-soft chip so the reason reads.
    render(
      <ProfitBadge
        value={null}
        marginPct={null}
        scale={null}
        onOpen={vi.fn()}
        emptyLabel="Maliyet girin"
      />,
    );
    const chip = screen.getByRole('button', { name: OPEN_LABEL }).firstElementChild as HTMLElement;
    expect(chip.className).toContain('bg-warning-surface');
    expect(chip.className).toContain('text-warning');
  });

  it('keeps the default em-dash empty state a mute neutral chip (no warning tone)', () => {
    // Non-tariff surfaces (orders, live sheet) pass no emptyLabel — the null badge stays
    // neutral, never adopting the warning tint reserved for a specific cause.
    render(<ProfitBadge value={null} marginPct={null} scale={null} onOpen={vi.fn()} />);
    const chip = screen.getByRole('button', { name: OPEN_LABEL }).firstElementChild as HTMLElement;
    expect(chip.className).not.toContain('warning');
    expect(chip).toHaveTextContent('—');
  });

  it('fills the badge with the margin-driven scale color when a margin is present', () => {
    // happy-dom cannot parse oklch()/color-mix(); feed an rgb scale so the resolved
    // text color lands on the element (the tinted bg/border are color-mix → dropped
    // by happy-dom, which is fine — the unit test covers the fill strings).
    const scale: MarginScale = {
      enabled: true,
      buckets: [
        { threshold: 0, color: 'rgb(200, 50, 50)' },
        { threshold: 20, color: 'rgb(50, 180, 50)' },
      ],
    };
    render(<ProfitBadge value="100.00" marginPct="25" scale={scale} onOpen={vi.fn()} />);
    // 25% → >= 20 → bucket[1] (green). The badge chip (the button's only child)
    // carries the inline color.
    const chip = screen.getByRole('button', { name: OPEN_LABEL }).firstElementChild as HTMLElement;
    expect(chip.style.color).toBe('rgb(50, 180, 50)');
  });
});
