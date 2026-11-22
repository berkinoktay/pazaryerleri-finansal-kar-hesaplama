import { describe, expect, it, vi } from 'vitest';

import { CostCellCreateBridge } from '@/features/costs/components/cost-cell-create-bridge';

import trMessages from '../../../../messages/tr.json';
import { render, screen, waitFor } from '../../../helpers/render';
import { server, http, HttpResponse } from '../../../helpers/msw';

// Turkish copy comes from the catalog so the new tests stay ASCII.
const costForm = trMessages.costs.form;

// ─── Constants ───────────────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const VARIANT_ID = 'variant-uuid-001';
const STORE_ID = '00000000-0000-0000-0000-0000000000a1';
const NEW_PROFILE_ID = 'new-profile-uuid-001';
const TEST_API_BASE = 'http://localhost:3001';

const newProfile = {
  id: NEW_PROFILE_ID,
  organizationId: ORG_ID,
  storeId: STORE_ID,
  name: 'Yeni Maliyet',
  type: 'COGS',
  amountGross: '30.00',
  vatRate: 18,
  note: null,
  archivedAt: null,
  createdBy: null,
  updatedBy: null,
  createdAt: '2026-05-09T00:00:00Z',
  updatedAt: '2026-05-09T00:00:00Z',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CostCellCreateBridge', () => {
  it('opens the create dialog when open=true', () => {
    render(
      <CostCellCreateBridge
        orgId={ORG_ID}
        variantId={VARIANT_ID}
        storeId={STORE_ID}
        open={true}
        onOpenChange={() => {}}
      />,
    );
    // The dialog renders with the create title
    expect(screen.getByText('Yeni maliyet profili')).toBeInTheDocument();
  });

  it('does not render dialog content when open=false', () => {
    render(
      <CostCellCreateBridge
        orgId={ORG_ID}
        variantId={VARIANT_ID}
        storeId={STORE_ID}
        open={false}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.queryByText('Yeni maliyet profili')).toBeNull();
  });

  it('after dialog success, calls attach mutation with new profile id + variant id', async () => {
    let attachPayload: { profileIds: string[]; variantIds: string[] } | null = null;

    server.use(
      http.post(`${TEST_API_BASE}/v1/organizations/${ORG_ID}/cost-profiles`, () =>
        HttpResponse.json(newProfile, { status: 201 }),
      ),
      http.post(
        `${TEST_API_BASE}/v1/organizations/${ORG_ID}/cost-profile-attachments/attach`,
        async ({ request }) => {
          attachPayload = (await request.json()) as { profileIds: string[]; variantIds: string[] };
          return HttpResponse.json({ attached: 1 });
        },
      ),
      http.get(`${TEST_API_BASE}/v1/organizations/${ORG_ID}/cost-profiles`, () =>
        HttpResponse.json({
          data: [newProfile],
          meta: { nextCursor: null, hasMore: false },
        }),
      ),
    );

    const { user } = render(
      <CostCellCreateBridge
        orgId={ORG_ID}
        variantId={VARIANT_ID}
        storeId={STORE_ID}
        open={true}
        onOpenChange={() => {}}
      />,
    );

    // Fill in the required fields: name + amount (other fields have defaults)
    const nameInput = screen.getByLabelText('Maliyet adı');
    await user.clear(nameInput);
    await user.type(nameInput, 'Yeni Maliyet');

    const amountInput = screen.getByLabelText('Maliyet (KDV dahil)');
    await user.clear(amountInput);
    await user.type(amountInput, '30.00');

    // Submit
    const submitButton = screen.getByRole('button', { name: 'Kaydet' });
    await user.click(submitButton);

    await waitFor(() => {
      expect(attachPayload).not.toBeNull();
      expect(attachPayload?.profileIds).toContain(NEW_PROFILE_ID);
      expect(attachPayload?.variantIds).toContain(VARIANT_ID);
    });
  });

  it('calls onChanged after create-and-attach', async () => {
    let attachCalls = 0;
    server.use(
      http.post(`${TEST_API_BASE}/v1/organizations/${ORG_ID}/cost-profiles`, () =>
        HttpResponse.json(newProfile, { status: 201 }),
      ),
      http.post(
        `${TEST_API_BASE}/v1/organizations/${ORG_ID}/cost-profile-attachments/attach`,
        () => {
          attachCalls += 1;
          return HttpResponse.json({ attached: 1 });
        },
      ),
      http.get(`${TEST_API_BASE}/v1/organizations/${ORG_ID}/cost-profiles`, () =>
        HttpResponse.json({
          data: [newProfile],
          meta: { nextCursor: null, hasMore: false },
        }),
      ),
    );
    const onChanged = vi.fn();

    const { user } = render(
      <CostCellCreateBridge
        orgId={ORG_ID}
        variantId={VARIANT_ID}
        storeId={STORE_ID}
        open={true}
        onOpenChange={() => {}}
        onChanged={onChanged}
      />,
    );

    const nameInput = screen.getByLabelText(costForm.fields.name);
    await user.clear(nameInput);
    await user.type(nameInput, 'Yeni Maliyet');

    const amountInput = screen.getByLabelText(costForm.fields.amountGross);
    await user.clear(amountInput);
    await user.type(amountInput, '30.00');

    await user.click(screen.getByRole('button', { name: costForm.submit }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(attachCalls).toBe(1);
  });
});
