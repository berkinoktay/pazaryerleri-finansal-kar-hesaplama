import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import { ErrorFallback } from '@/components/common/error-fallback';
import { ApiError } from '@/lib/api-error';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import trMessages from '../../../messages/tr.json';

function renderFallback(props: React.ComponentProps<typeof ErrorFallback>) {
  return render(
    <NextIntlClientProvider messages={trMessages} locale="tr">
      <ErrorFallback {...props} />
    </NextIntlClientProvider>,
  );
}

describe('<ErrorFallback>', () => {
  it('renders the localized title and a reset button that fires on click', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    renderFallback({ reset });

    expect(screen.getByText('Bir şeyler ters gitti.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /tekrar dene/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('renders the support id when the error is an ApiError with requestId', () => {
    const requestId = '3d2c3b1a-5a7d-4f62-b1a0-1e5a9b6a1234';
    const apiError = new ApiError(500, 'INTERNAL_ERROR', 'boom', {
      type: 'https://api.pazarsync.com/errors/internal',
      title: 'Internal error',
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'boom',
      meta: { requestId },
    });

    renderFallback({ error: apiError });

    expect(screen.getByText('Destek kimliği')).toBeInTheDocument();
    expect(screen.getByText(requestId)).toBeInTheDocument();
  });

  it('falls back to error.digest when no ApiError requestId is available', () => {
    const error = Object.assign(new Error('server throw'), { digest: 'NEXT_DIGEST_abc123' });

    renderFallback({ error });

    expect(screen.getByText('NEXT_DIGEST_abc123')).toBeInTheDocument();
  });

  it('hides the support id section entirely when no correlation id is present', () => {
    renderFallback({ error: new Error('plain') });

    expect(screen.queryByText('Destek kimliği')).toBeNull();
  });
});
