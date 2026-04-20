import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import { CreateOrganizationForm } from '@/features/organization/components/create-organization-form';
import trMessages from '../../../../messages/tr.json';

import { render, screen, waitFor } from '../../../helpers/render';
import { http, HttpResponse, server } from '../../../helpers/msw';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/active-org-actions', () => ({
  setActiveOrgIdAction: vi.fn(async () => undefined),
}));

function renderForm() {
  return render(
    <NextIntlClientProvider messages={trMessages} locale="tr">
      <CreateOrganizationForm />
    </NextIntlClientProvider>,
  );
}

describe('CreateOrganizationForm', () => {
  it('shows a translated error when the name is too short', async () => {
    const { user } = renderForm();

    await user.type(screen.getByLabelText(/organizasyon adı/i), 'A');
    await user.click(screen.getByRole('button', { name: /oluştur/i }));

    await waitFor(() => {
      expect(screen.getByText(/en az 2 karakter/i)).toBeInTheDocument();
    });
  });

  it('shows a translated error when the name is reserved', async () => {
    const { user } = renderForm();

    await user.type(screen.getByLabelText(/organizasyon adı/i), 'admin');
    await user.click(screen.getByRole('button', { name: /oluştur/i }));

    await waitFor(() => {
      expect(screen.getByText(/kullanılamaz/i)).toBeInTheDocument();
    });
  });

  it('submits a valid name and the mutation calls the API', async () => {
    let captured: unknown;
    server.use(
      http.post('http://localhost:3001/v1/organizations', async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(
          {
            id: '00000000-0000-0000-0000-000000000001',
            name: 'Akyıldız Ticaret',
            slug: 'akyildiz-ticaret',
            currency: 'TRY',
            timezone: 'Europe/Istanbul',
            createdAt: '2026-04-20T10:00:00Z',
            updatedAt: '2026-04-20T10:00:00Z',
            membership: { role: 'OWNER' },
          },
          { status: 201 },
        );
      }),
    );

    const { user } = renderForm();

    await user.type(screen.getByLabelText(/organizasyon adı/i), 'Akyıldız Ticaret');
    await user.click(screen.getByRole('button', { name: /oluştur/i }));

    await waitFor(() => {
      expect(captured).toEqual({ name: 'Akyıldız Ticaret' });
    });
  });
});
