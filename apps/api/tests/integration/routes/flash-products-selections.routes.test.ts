// Integration tests for PATCH .../flash-products/{listId}/selections.
//
// Selections are persisted in one bulk update scoped to the list, so the interesting
// properties are: (1) the chosen offer (H24) round-trips to the detail and the list's
// selectedCount, (2) a custom price (offer null) round-trips, (3) an itemId from another
// list is silently skipped (updated: 0), (4) clearing sets the fields back, (5) an
// invalid custom price is a 422, and (6) a choice the export could not write (an offer
// the item does not store, a custom price above its lowest offer or on an item with no
// offer) refuses the whole request with nothing written.

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

/** Adds an item with the given offer prices to `listId` (a list of the seeded store). */
async function addItem(
  s: Seeded,
  listId: string,
  sortOrder: number,
  offers: { offer24Price: string | null; offer3Price: string | null },
): Promise<string> {
  const item = await prisma.flashProductItem.create({
    data: {
      organizationId: s.orgId,
      storeId: s.storeId,
      listId,
      barcode: `BC-EXTRA-${sortOrder.toString()}`,
      productTitle: 'Extra product',
      currentPrice: '100.00',
      customerPrice: '100.00',
      currentCommissionPct: '19',
      hasCommissionTariff: false,
      sortOrder,
      ...offers,
    },
  });
  return item.id;
}

async function readSelection(
  itemId: string,
): Promise<{ selectedOffer: string | null; customPrice: string | null }> {
  const row = await prisma.flashProductItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { selectedOffer: true, customPrice: true },
  });
  return {
    selectedOffer: row.selectedOffer,
    customPrice: row.customPrice === null ? null : row.customPrice.toFixed(2),
  };
}

const NO_SELECTION = { selectedOffer: null, customPrice: null };

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
    // The seed stores a 24-hour offer only; give item1 a 3-hour offer so H3 is accepted.
    await prisma.flashProductItem.update({
      where: { id: s.item1 },
      data: { offer3Price: '80.00' },
    });
    const saved = await patchSelections(s, {
      selections: [{ itemId: s.item1, offer: 'H3', customPrice: null }],
    });
    expect(saved.status).toBe(200);
    expect(await readSelection(s.item1)).toEqual({ selectedOffer: 'H3', customPrice: null });

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

  it('rejects an offer AND a custom price on the same row (422 INVALID_SELECTION_XOR)', async () => {
    const s = await seedListWithItems();
    const res = await patchSelections(s, {
      selections: [{ itemId: s.item1, offer: 'H24', customPrice: '100.00' }],
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; errors: { code: string }[] };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.some((e) => e.code === 'INVALID_SELECTION_XOR')).toBe(true);
  });

  it('refuses an offer the item does not store (422 OFFER_NOT_STORED) and writes nothing', async () => {
    const s = await seedListWithItems();
    const before = await patchSelections(s, {
      selections: [{ itemId: s.item1, offer: 'H24', customPrice: null }],
    });
    expect(before.status).toBe(200);

    // item1 stores no 3-hour offer; the valid item2 entry of the same request is not
    // written either (all-or-nothing).
    const res = await patchSelections(s, {
      selections: [
        { itemId: s.item1, offer: 'H3', customPrice: null },
        { itemId: s.item2, offer: 'H24', customPrice: null },
      ],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'selections.0.offer', code: 'OFFER_NOT_STORED' }],
    });
    expect(await readSelection(s.item1)).toEqual({ selectedOffer: 'H24', customPrice: null });
    expect(await readSelection(s.item2)).toEqual(NO_SELECTION);
  });

  it('refuses a custom price above the lowest offer (422 CUSTOM_PRICE_ABOVE_MAX) and saves one equal to it', async () => {
    const s = await seedListWithItems();
    // Two offers: the ceiling is the LOWER one (80.00), not the 24-hour 90.00.
    const bothOffers = await addItem(s, s.listId, 2, {
      offer24Price: '90.00',
      offer3Price: '80.00',
    });

    const res = await patchSelections(s, {
      selections: [
        { itemId: s.item2, offer: null, customPrice: '79.90' },
        { itemId: bothOffers, offer: null, customPrice: '80.01' },
      ],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'selections.1.customPrice', code: 'CUSTOM_PRICE_ABOVE_MAX' }],
    });
    expect(await readSelection(s.item2)).toEqual(NO_SELECTION);
    expect(await readSelection(bothOffers)).toEqual(NO_SELECTION);

    const accepted = await patchSelections(s, {
      selections: [{ itemId: bothOffers, offer: null, customPrice: '80.00' }],
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ updated: 1 });
    expect(await readSelection(bothOffers)).toEqual({ selectedOffer: null, customPrice: '80.00' });
  });

  it('refuses a custom price on an item that stores no offer (422 OFFER_NOT_STORED on customPrice)', async () => {
    const s = await seedListWithItems();
    const noOffer = await addItem(s, s.listId, 2, { offer24Price: null, offer3Price: null });

    const res = await patchSelections(s, {
      selections: [{ itemId: noOffer, offer: null, customPrice: '50.00' }],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'selections.0.customPrice', code: 'OFFER_NOT_STORED' }],
    });
    expect(await readSelection(noOffer)).toEqual(NO_SELECTION);
  });

  it('refuses a custom price wider than the stored column (422 INVALID_CUSTOM_PRICE, not a 500)', async () => {
    const s = await seedListWithItems();
    const res = await patchSelections(s, {
      selections: [{ itemId: s.item1, offer: null, customPrice: '12345678901' }],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'selections.0.customPrice', code: 'INVALID_CUSTOM_PRICE' }],
    });
    expect(await readSelection(s.item1)).toEqual(NO_SELECTION);
  });

  it('skips an item of another list of the same store without naming it (200, updated: 0)', async () => {
    const s = await seedListWithItems();
    const otherList = await prisma.flashProductList.create({
      data: { organizationId: s.orgId, storeId: s.storeId, name: 'Other list' },
    });
    // On its own list this item would be refused: it stores no 3-hour offer.
    const foreignItem = await addItem(s, otherList.id, 0, {
      offer24Price: '90.00',
      offer3Price: null,
    });

    const res = await patchSelections(s, {
      selections: [{ itemId: foreignItem, offer: 'H3', customPrice: null }],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 0 });
    expect(await readSelection(foreignItem)).toEqual(NO_SELECTION);
  });
});
