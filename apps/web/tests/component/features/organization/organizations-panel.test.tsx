import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { OrganizationsPanel } from '@/features/organization/components/organizations-panel';

import trMessages from '../../../../messages/tr.json';
import { server, http, HttpResponse } from '../../../helpers/msw';
import { render, screen, waitFor } from '../../../helpers/render';

function renderPanel() {
  return render(
    <NextIntlClientProvider messages={trMessages} locale="tr">
      <OrganizationsPanel />
    </NextIntlClientProvider>,
  );
}

describe('<OrganizationsPanel>', () => {
  it('renders a retry button on load error and refetches on click', async () => {
    let requestCount = 0;
    server.use(
      http.get('http://localhost:3001/v1/organizations', () => {
        requestCount += 1;
        // First call fails; second call (after retry button click) succeeds.
        if (requestCount === 1) {
          return HttpResponse.json(
            {
              type: 'https://api.pazarsync.com/errors/internal',
              title: 'Internal server error',
              status: 500,
              code: 'INTERNAL_ERROR',
              detail: 'db gone',
            },
            { status: 500 },
          );
        }
        return HttpResponse.json({
          data: [
            {
              id: 'org-1',
              name: 'Akyıldız Ticaret',
              slug: 'akyildiz-ticaret',
              currency: 'TRY',
              timezone: 'Europe/Istanbul',
              createdAt: '2026-04-20T10:00:00Z',
              updatedAt: '2026-04-20T10:00:00Z',
            },
          ],
        });
      }),
    );

    const { user } = renderPanel();

    // The error message renders first
    await waitFor(() => expect(screen.getByText(/yüklenemedi/i)).toBeInTheDocument());

    // A retry button is available
    const retryButton = screen.getByRole('button', { name: /tekrar dene/i });

    // Click retry → second request fires → success state renders
    await user.click(retryButton);

    await waitFor(() => expect(screen.getByText('Akyıldız Ticaret')).toBeInTheDocument());
    expect(requestCount).toBe(2);
  });
});
