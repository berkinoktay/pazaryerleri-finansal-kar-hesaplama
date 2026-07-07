// Integration tests for PATCH .../flash-products/{listId}/selections.
//
// Selections are persisted in one bulk update scoped to the list, so the interesting
// properties are: (1) the chosen offer (H24) round-trips to the detail and the list's
// selectedCount, (2) a custom price (offer null) round-trips, (3) an itemId from another
// list is silently skipped (updated: 0), (4) clearing sets the fields back, and (5) an
// invalid custom price is a 422.

import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

interface Seeded {
  accessToken: string;
  orgId: string;
  storeId: string;
  listId: string;
  item1: string;
  item2: string;
}

async function seedListWithItems(): Promise<Seeded> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);
  // getFlashProductDetail resolves fee definitions; restore them after truncateAll.
  await ensureFeeDefinitions();

  const list = await prisma.flashProductList.create({
    data: { organizationId: org.id, storeId: store.id, name: 'Flaş Seçim Testi' },
  });
  const baseItem = {
    organizationId: org.id,
    storeId: store.id,
    listId: list.id,
    productTitle: 'Ürün',
    currentPrice: '100.00',
    customerPrice: '100.00',
    currentCommissionPct: '19',
    hasCommissionTariff: false,
    offer24Price: '90.00',
  };
  const item1 = await prisma.flashProductItem.create({
    data: { ...baseItem, barcode: 'BC-1', sortOrder: 0 },
  });
  const item2 = await prisma.flashProductItem.create({
    data: { ...baseItem, barcode: 'BC-2', sortOrder: 1 },
  });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    listId: list.id,
    item1: item1.id,
    item2: item2.id,
  };
}

async function patchSelections(s: Seeded, body: unknown): Promise<Response> {
  return app.request(
    `/v1/organizations/${s.orgId}/stores/${s.storeId}/flash-products/${s.listId}/selections`,
    {
      method: 'PATCH',
      headers: { Authorization: bearer(s.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

describe('PATCH .../flash-products/{listId}/selections', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('saves an offer choice + a custom price (XOR) and reflects them in detail and the list count', async () => {
    const s = await seedListWithItems();

    const res = await patchSelections(s, {
      selections: [
        { itemId: s.item1, offer: 'H24', customPrice: null },
        { itemId: s.item2, offer: null, customPrice: '79.90' },
      ],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(2);

    const detail = (await (
      await app.request(
        `/v1/organizations/${s.orgId}/stores/${s.storeId}/flash-products/${s.listId}`,
        { headers: { Authorization: bearer(s.accessToken) } },
      )
    ).json()) as {
      items: { id: string; selectedOffer: string | null; customPrice: string | null }[];
    };
    const items = detail.items;
    expect(items.find((i) => i.id === s.item1)?.selectedOffer).toBe('H24');
    expect(items.find((i) => i.id === s.item1)?.customPrice).toBeNull();
    expect(items.find((i) => i.id === s.item2)?.selectedOffer).toBeNull();
    expect(items.find((i) => i.id === s.item2)?.customPrice).toBe('79.90');

    const list = (await (
      await app.request(`/v1/organizations/${s.orgId}/stores/${s.storeId}/flash-products`, {
        headers: { Authorization: bearer(s.accessToken) },
      })
    ).json()) as { data: { selectedCount: number }[] };
    expect(list.data[0]?.selectedCount).toBe(2);
  });

  it('ignores an itemId that does not belong to the list (updated: 0)', async () => {
    const s = await seedListWithItems();
    const res = await patchSelections(s, {
      selections: [{ itemId: crypto.randomUUID(), offer: 'H24', customPrice: null }],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(0);
  });

  it('clears a selection back to no offer with null custom price', async () => {
    const s = await seedListWithItems();
    await patchSelections(s, {
      selections: [{ itemId: s.item1, offer: 'H3', customPrice: null }],
    });

    const res = await patchSelections(s, {
      selections: [{ itemId: s.item1, offer: null, customPrice: null }],
    });
    expect(res.status).toBe(200);

    const row = await prisma.flashProductItem.findUnique({ where: { id: s.item1 } });
    expect(row?.selectedOffer).toBeNull();
    expect(row?.customPrice).toBeNull();
  });

  it('rejects an invalid custom price (422)', async () => {
    const s = await seedListWithItems();
    const res = await patchSelections(s, {
      selections: [{ itemId: s.item1, offer: null, customPrice: 'not-a-price' }],
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('VALIDATION_ERROR');
  });
});
