import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { OrdersToolbar } from '@/features/orders/components/orders-toolbar';

import messages from '../../../../messages/tr.json';
import { FORMATS } from '../../../../src/i18n/formats';

function renderToolbar(props: Partial<React.ComponentProps<typeof OrdersToolbar>> = {}): void {
  render(
    <NextIntlClientProvider
      locale="tr"
      messages={messages}
      formats={FORMATS}
      timeZone="Europe/Istanbul"
    >
      <OrdersToolbar
        q=""
        status={null}
        reconciliationStatus={null}
        lossOnly={false}
        from=""
        to=""
        onChange={vi.fn()}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe('OrdersToolbar — loss-only toggle + Excel placeholder', () => {
  it('emits { lossOnly: true } when the toggle is pressed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderToolbar({ onChange });

    await user.click(screen.getByRole('button', { name: /sadece zararlı/i }));

    expect(onChange).toHaveBeenCalledWith({ lossOnly: true });
  });

  it('renders an Excel button that is a no-op placeholder (no backend yet)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderToolbar({ onChange });

    await user.click(screen.getByRole('button', { name: /excel/i }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
