import { describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';

import { ProfitSettingsForm } from '@/features/profit-settings/components/profit-settings-form';

import { render, screen, createTestQueryClient } from '../helpers/render';
import { server, http, HttpResponse } from '../helpers/msw';

const TEST_API_BASE = 'http://localhost:3001';
const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const ENDPOINT = `${TEST_API_BASE}/v1/organizations/${ORG_ID}/stores/${STORE_ID}/profit-settings`;

interface SetupOptions {
  settings?: { includeStopaj: boolean; includeNegativeNetVat: boolean };
  onPatch?: (body: unknown) => void;
}

function setup({ settings, onPatch }: SetupOptions = {}) {
  const resolved = settings ?? { includeStopaj: true, includeNegativeNetVat: false };
  const queryClient = createTestQueryClient();

  server.use(http.get(ENDPOINT, () => HttpResponse.json(resolved, { status: 200 })));
  server.use(
    http.patch(ENDPOINT, async ({ request }) => {
      const body = await request.json();
      onPatch?.(body);
      return HttpResponse.json(body, { status: 200 });
    }),
  );

  const result = render(<ProfitSettingsForm orgId={ORG_ID} storeId={STORE_ID} />, { queryClient });
  return { ...result, queryClient };
}

describe('<ProfitSettingsForm>', () => {
  it('renders both toggles', () => {
    setup();
    expect(screen.getByRole('switch', { name: /stopaj/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /kdv/i })).toBeInTheDocument();
  });

  it('reflects the loaded settings (stopaj on, negative net VAT off by default)', async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /stopaj/i })).toBeChecked();
    });
    expect(screen.getByRole('switch', { name: /kdv/i })).not.toBeChecked();
  });

  it('loads a stored "include negative net VAT" preference as checked', async () => {
    setup({ settings: { includeStopaj: false, includeNegativeNetVat: true } });
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /kdv/i })).toBeChecked();
    });
    expect(screen.getByRole('switch', { name: /stopaj/i })).not.toBeChecked();
  });

  it('toggles negative net VAT on and saves the full draft', async () => {
    let patchedBody: unknown;
    const { user } = setup({ onPatch: (b) => (patchedBody = b) });

    // Wait for the server snapshot to load (stopaj on, negative net VAT off).
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /stopaj/i })).toBeChecked();
    });

    await user.click(screen.getByRole('switch', { name: /kdv/i }));
    expect(screen.getByRole('switch', { name: /kdv/i })).toBeChecked();

    await user.click(screen.getByRole('button', { name: /kaydet/i }));

    await waitFor(() => {
      expect(patchedBody).toEqual({ includeStopaj: true, includeNegativeNetVat: true });
    });
  });
});
