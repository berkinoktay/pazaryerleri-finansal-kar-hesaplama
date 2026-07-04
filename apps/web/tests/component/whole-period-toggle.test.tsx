import { describe, expect, it, vi } from 'vitest';

import { WholePeriodToggle } from '@/features/campaigns/components/whole-period-toggle';

import { render, screen } from '../helpers/render';

const LABEL = '7 güne uygula';
const ACTIVE_LABEL = '7 gün uygulandı';

describe('WholePeriodToggle', () => {
  it('shows the apply label + unpressed state and toggles on click when inactive', async () => {
    const onToggle = vi.fn();
    const { user } = render(
      <WholePeriodToggle
        active={false}
        onToggle={onToggle}
        label={LABEL}
        activeLabel={ACTIVE_LABEL}
      />,
    );

    const button = screen.getByRole('button', { name: LABEL });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await user.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('shows the applied label + pressed state when active', () => {
    render(
      <WholePeriodToggle active onToggle={vi.fn()} label={LABEL} activeLabel={ACTIVE_LABEL} />,
    );

    const button = screen.getByRole('button', { name: ACTIVE_LABEL });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(LABEL)).not.toBeInTheDocument();
  });
});
