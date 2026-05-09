import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyableValue } from '@/components/patterns/copyable-value';

import { render, screen } from '@/../tests/helpers/render';

const messages = {
  common: {
    copy: {
      copy: '{label} kopyala',
      copied: '{label} kopyalandı',
    },
  },
};

function renderCopy(value = 'STK-12345', label = 'Stok Kodu') {
  return render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <CopyableValue value={value} label={label}>
        <span>{value}</span>
      </CopyableValue>
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CopyableValue', () => {
  it('renders the children and a copy button labeled by the field name', () => {
    renderCopy();
    expect(screen.getByText('STK-12345')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stok Kodu kopyala' })).toBeInTheDocument();
  });

  it('writes the value to navigator.clipboard on click and announces the copied state', async () => {
    // happy-dom ships its own navigator.clipboard implementation which
    // resolves silently — spy on writeText directly so we can assert the
    // call without replacing the whole object (which is non-configurable
    // in some happy-dom versions).
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();

    const { user } = renderCopy();
    await user.click(screen.getByRole('button', { name: 'Stok Kodu kopyala' }));

    expect(writeText).toHaveBeenCalledWith('STK-12345');
    // After the awaited writeText resolves, the button's aria-label flips to
    // the "copied" string — the icon swap is visual; aria-label is the
    // source of truth assistive tech reads.
    expect(await screen.findByRole('button', { name: 'Stok Kodu kopyalandı' })).toBeInTheDocument();
  });

  it('stays silent when the clipboard API rejects (insecure context, etc.)', async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValue(new Error('insecure context'));

    const { user } = renderCopy();
    await user.click(screen.getByRole('button', { name: 'Stok Kodu kopyala' }));

    expect(writeText).toHaveBeenCalledWith('STK-12345');
    // Aria-label remains in the "copy" state — no fake confirmation when
    // the write actually failed.
    expect(screen.getByRole('button', { name: 'Stok Kodu kopyala' })).toBeInTheDocument();
  });
});
