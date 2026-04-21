import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import { ErrorFallback } from '@/components/common/error-fallback';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import trMessages from '../../../messages/tr.json';

describe('<ErrorFallback>', () => {
  it('renders the localized title and a reset button that fires on click', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(
      <NextIntlClientProvider messages={trMessages} locale="tr">
        <ErrorFallback reset={reset} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText('Bir şeyler ters gitti.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /tekrar dene/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
