import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NetworkStatusBanner } from '@/components/common/network-status-banner';

import trMessages from '../../../messages/tr.json';
import { render, waitFor } from '../../helpers/render';

function renderBanner() {
  return render(
    <NextIntlClientProvider messages={trMessages} locale="tr">
      <NetworkStatusBanner />
    </NextIntlClientProvider>,
  );
}

function setOnLine(value: boolean): void {
  Object.defineProperty(globalThis.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

describe('<NetworkStatusBanner>', () => {
  beforeEach(() => {
    setOnLine(true);
  });

  afterEach(() => {
    // Reset to default online state for the next test; happy-dom doesn't
    // expose `onLine` as an own property so a simple "restore descriptor"
    // via getOwnPropertyDescriptor returns undefined. The configurable
    // override we set in beforeEach stays writable, so resetting to `true`
    // is enough.
    setOnLine(true);
    vi.restoreAllMocks();
  });

  it('does not render anything when the browser is online', () => {
    const { container } = renderBanner();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('renders the localized offline banner when the browser is offline', async () => {
    const { container } = renderBanner();

    setOnLine(false);

    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(container).toHaveTextContent(
      'İnternet bağlantın yok. Değişikliklerin kaydedilmeyebilir.',
    );
  });

  it('hides the banner after an `online` event fires', async () => {
    // Start offline → after mount + effect, banner should render.
    setOnLine(false);

    const { container } = renderBanner();
    await waitFor(() => {
      expect(container.querySelector('[role="status"]')).not.toBeNull();
    });

    setOnLine(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
