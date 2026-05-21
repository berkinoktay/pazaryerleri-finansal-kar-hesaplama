import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WebhookSection } from '@/features/stores/components/webhook-section';

import { http, HttpResponse, server } from '../../../helpers/msw';
import { render, screen, waitFor } from '../../../helpers/render';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const STORE_ID = '00000000-0000-0000-0000-0000000000aa';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

function stubStoresEndpoint(webhookActiveAt: string | null): void {
  server.use(
    http.get(`http://localhost:3001/v1/organizations/${ORG_ID}/stores`, () => {
      return HttpResponse.json({
        data: [
          {
            id: STORE_ID,
            name: 'Test Trendyol',
            platform: 'TRENDYOL',
            environment: 'PRODUCTION',
            externalAccountId: '99999',
            status: 'ACTIVE',
            lastConnectedAt: '2026-05-01T10:00:00Z',
            lastSyncAt: null,
            webhookActiveAt,
            createdAt: '2026-05-01T10:00:00Z',
            updatedAt: '2026-05-01T10:00:00Z',
          },
        ],
      });
    }),
  );
}

describe('WebhookSection', () => {
  beforeEach(() => {
    toast.success.mockReset();
    toast.error.mockReset();
  });

  it('renders the inactive state when webhookActiveAt is null', async () => {
    stubStoresEndpoint(null);

    render(<WebhookSection orgId={ORG_ID} storeId={STORE_ID} platform="TRENDYOL" />);

    await waitFor(() => {
      expect(screen.getByText('Webhook bağlı değil')).toBeInTheDocument();
    });
    // The "Aktif:" prefix should NOT appear in the inactive state.
    expect(screen.queryByText(/^Aktif:$/)).not.toBeInTheDocument();
  });

  it('renders the active state with an activation timestamp when webhookActiveAt is set', async () => {
    stubStoresEndpoint('2026-05-20T12:00:00.000Z');

    render(<WebhookSection orgId={ORG_ID} storeId={STORE_ID} platform="TRENDYOL" />);

    await waitFor(() => {
      expect(screen.getByText('Webhook bağlı')).toBeInTheDocument();
    });
    expect(screen.getByText('Aktif:')).toBeInTheDocument();
  });

  it('renders nothing for non-Trendyol platforms', () => {
    const { container } = render(
      <WebhookSection orgId={ORG_ID} storeId={STORE_ID} platform="HEPSIBURADA" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('rotates the secret on confirmation and shows a success toast', async () => {
    stubStoresEndpoint('2026-05-20T12:00:00.000Z');

    let rotateCalled = false;
    server.use(
      http.post(
        `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/webhook/rotate-secret`,
        () => {
          rotateCalled = true;
          return HttpResponse.json({ rotatedAt: '2026-05-21T12:00:00.000Z' }, { status: 200 });
        },
      ),
    );

    const { user } = render(
      <WebhookSection orgId={ORG_ID} storeId={STORE_ID} platform="TRENDYOL" />,
    );

    // Open the confirm dialog
    const openBtn = await screen.findByRole('button', { name: 'Gizli anahtarı yenile' });
    await user.click(openBtn);

    // Confirm — the dialog's CTA uses the specific verb form
    const confirmBtn = await screen.findByRole('button', { name: 'Anahtarı yenile' });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(rotateCalled).toBe(true);
    });
    expect(toast.success).toHaveBeenCalledWith('Webhook gizli anahtarı yenilendi.');
  });
});
