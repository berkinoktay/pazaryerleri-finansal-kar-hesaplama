import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { OrdersCostStatusTabs } from '@/features/orders/components/orders-cost-status-tabs';

const messages = {
  ordersPage: {
    tabs: { calculated: 'Hesaplanmış', excluded: 'Kâr Hesabı Dışı', emptyCalculated: 'x' },
  },
};

function renderTabs(props: React.ComponentProps<typeof OrdersCostStatusTabs>): void {
  render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <OrdersCostStatusTabs {...props} />
    </NextIntlClientProvider>,
  );
}

describe('OrdersCostStatusTabs', () => {
  it('renders both segments with their counts and drives onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderTabs({ value: 'calculated', counts: { calculated: 12, excluded: 3 }, onChange });

    expect(screen.getByText('Hesaplanmış')).toBeInTheDocument();
    expect(screen.getByText('Kâr Hesabı Dışı')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    await user.click(screen.getByText('Kâr Hesabı Dışı'));
    expect(onChange).toHaveBeenCalledWith('excluded');
  });
});
