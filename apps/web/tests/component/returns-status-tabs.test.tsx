import { describe, expect, it, vi } from 'vitest';

import { ReturnsStatusTabs } from '@/features/returns/components/returns-status-tabs';

import { render, screen } from '../helpers/render';

describe('ReturnsStatusTabs', () => {
  it('renders the three tabs with counts and reports tab changes', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <ReturnsStatusTabs
        value="all"
        counts={{ all: 16, open: 4, resolved: 12 }}
        loading={false}
        onChange={onChange}
      />,
    );

    expect(screen.getByText('Tümü')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument(); // open sayacı
    expect(screen.getByText('12')).toBeInTheDocument(); // resolved sayacı

    await user.click(screen.getByText('Açık'));
    expect(onChange).toHaveBeenCalledWith('open');
  });
});
