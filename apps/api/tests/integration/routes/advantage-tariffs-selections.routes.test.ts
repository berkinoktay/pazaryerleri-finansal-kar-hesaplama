// Integration tests for PATCH .../advantage-tariffs/{id}/selections.
//
// Selections are persisted in one bulk update scoped to the tariff, so the
// interesting properties are: (1) the chosen star tier + custom price round-trip to
// the detail and the list's selectedCount, (2) an itemId from another tariff is
// silently skipped (updated: 0), (3) clearing sets the fields back, (4) an
// invalid custom price is a 422, and (5) a tier the item does not store refuses the
// whole request with nothing written. The seed items store all three tiers.

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
  tariffId: string;
  item1: string;
  item2: string;
}

async function seedTariffWithItems(): Promise<Seeded> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);
  // getAdvantageTariffDetail resolves fee definitions; restore them after truncateAll.
  await ensureFeeDefinitions();

  const tariff = await prisma.advantageTariff.create({
    data: { organizationId: org.id, storeId: store.id, name: 'Avantaj Seçim Testi' },
  });
  const baseItem = {
    organizationId: org.id,
    storeId: store.id,
    tariffId: tariff.id,
    productTitle: 'Ürün',
    currentPrice: '100.00',
    customerPrice: '100.00',
    hasCommissionTariff: false,
    starTiers: [
      { key: 'tier1', upperLimit: '90.00', lowerLimit: '85.00' },
      { key: 'tier2', upperLimit: '84.99', lowerLimit: '70.00' },
      { key: 'tier3', upperLimit: '69.99' },
    ],
    applyUntilEnd: false,
  };
  const item1 = await prisma.advantageTariffItem.create({
    data: { ...baseItem, barcode: 'BC-1', sortOrder: 0 },
  });
  const item2 = await prisma.advantageTariffItem.create({
    data: { ...baseItem, barcode: 'BC-2', sortOrder: 1 },
  });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    tariffId: tariff.id,
    item1: item1.id,
    item2: item2.id,
  };
}

/** Adds an item that stores the tier1 band only to `tariffId` (a tariff of the seeded store). */
async function addTier1OnlyItem(s: Seeded, tariffId: string, sortOrder: number): Promise<string> {
  const item = await prisma.advantageTariffItem.create({
    data: {
      organizationId: s.orgId,
      storeId: s.storeId,
      tariffId,
      barcode: `BC-TIER1-${sortOrder.toString()}`,
      productTitle: 'Tier1 only product',
      currentPrice: '100.00',
      customerPrice: '100.00',
      hasCommissionTariff: false,
      starTiers: [{ key: 'tier1', upperLimit: '90.00', lowerLimit: '85.00' }],
      applyUntilEnd: false,
      sortOrder,
    },
  });
  return item.id;
}

async function readSelection(
  itemId: string,
): Promise<{ selectedTier: string | null; customPrice: string | null }> {
  const row = await prisma.advantageTariffItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { selectedTier: true, customPrice: true },
  });
  return {
    selectedTier: row.selectedTier,
    customPrice: row.customPrice === null ? null : row.customPrice.toFixed(2),
  };
}

const NO_SELECTION = { selectedTier: null, customPrice: null };

async function patchSelections(s: Seeded, body: unknown): Promise<Response> {
  return app.request(
    `/v1/organizations/${s.orgId}/stores/${s.storeId}/advantage-tariffs/${s.tariffId}/selections`,
    {
      method: 'PATCH',
      headers: { Authorization: bearer(s.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

describe('PATCH .../advantage-tariffs/{id}/selections', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('saves the tier choice + custom price and reflects it in detail and the list count', async () => {
    const s = await seedTariffWithItems();

    const res = await patchSelections(s, {
      selections: [{ itemId: s.item1, tier: 'tier1', customPrice: '199.90' }],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(1);

    const detail = (await (
      await app.request(
        `/v1/organizations/${s.orgId}/stores/${s.storeId}/advantage-tariffs/${s.tariffId}`,
        { headers: { Authorization: bearer(s.accessToken) } },
      )
    ).json()) as {
      items: { id: string; selectedTier: string | null; customPrice: string | null }[];
    };
    const items = detail.items;
    expect(items.find((i) => i.id === s.item1)?.selectedTier).toBe('tier1');
    expect(items.find((i) => i.id === s.item1)?.customPrice).toBe('199.90');
    expect(items.find((i) => i.id === s.item2)?.selectedTier).toBeNull();

    const list = (await (
      await app.request(`/v1/organizations/${s.orgId}/stores/${s.storeId}/advantage-tariffs`, {
        headers: { Authorization: bearer(s.accessToken) },
      })
    ).json()) as { data: { selectedCount: number }[] };
    expect(list.data[0]?.selectedCount).toBe(1);
  });

  it('ignores an itemId that does not belong to the tariff (updated: 0)', async () => {
    const s = await seedTariffWithItems();
    const res = await patchSelections(s, {
      selections: [{ itemId: crypto.randomUUID(), tier: 'tier1', customPrice: null }],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(0);
  });

  it('clears a selection back to no tier with null custom price', async () => {
    const s = await seedTariffWithItems();
    const saved = await patchSelections(s, {
      selections: [{ itemId: s.item1, tier: 'tier2', customPrice: '50.00' }],
    });
    expect(saved.status).toBe(200);

    const res = await patchSelections(s, {
      selections: [{ itemId: s.item1, tier: null, customPrice: null }],
    });
    expect(res.status).toBe(200);

    const row = await prisma.advantageTariffItem.findUnique({ where: { id: s.item1 } });
    expect(row?.selectedTier).toBeNull();
    expect(row?.customPrice).toBeNull();
  });

  it('rejects an invalid custom price (422)', async () => {
    const s = await seedTariffWithItems();
    const res = await patchSelections(s, {
      selections: [{ itemId: s.item1, tier: 'tier1', customPrice: 'not-a-price' }],
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('refuses a custom price wider than the stored column (422 INVALID_CUSTOM_PRICE, not a 500)', async () => {
    const s = await seedTariffWithItems();
    const res = await patchSelections(s, {
      selections: [{ itemId: s.item1, tier: 'tier1', customPrice: '12345678901' }],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'selections.0.customPrice', code: 'INVALID_CUSTOM_PRICE' }],
    });
    expect(await readSelection(s.item1)).toEqual(NO_SELECTION);
  });

  it('refuses a tier the item does not store (422 TIER_NOT_STORED) and writes nothing', async () => {
    const s = await seedTariffWithItems();
    const tier1Only = await addTier1OnlyItem(s, s.tariffId, 2);

    // Without a custom price; the valid item1 entry of the same request is not written
    // either (all-or-nothing).
    const res = await patchSelections(s, {
      selections: [
        { itemId: tier1Only, tier: 'tier3', customPrice: null },
        { itemId: s.item1, tier: 'tier2', customPrice: null },
      ],
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'selections.0.tier', code: 'TIER_NOT_STORED' }],
    });

    // A custom price does not waive the rule.
    const withPrice = await patchSelections(s, {
      selections: [{ itemId: tier1Only, tier: 'tier2', customPrice: '79.90' }],
    });
    expect(withPrice.status).toBe(422);
    expect(await withPrice.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'selections.0.tier', code: 'TIER_NOT_STORED' }],
    });

    expect(await readSelection(tier1Only)).toEqual(NO_SELECTION);
    expect(await readSelection(s.item1)).toEqual(NO_SELECTION);

    // Control: the tier the item stores is accepted.
    const accepted = await patchSelections(s, {
      selections: [{ itemId: tier1Only, tier: 'tier1', customPrice: null }],
    });
    expect(accepted.status).toBe(200);
    expect(await readSelection(tier1Only)).toEqual({ selectedTier: 'tier1', customPrice: null });
  });

  it('skips an item of another tariff of the same store without naming it (200, updated: 0)', async () => {
    const s = await seedTariffWithItems();
    const otherTariff = await prisma.advantageTariff.create({
      data: { organizationId: s.orgId, storeId: s.storeId, name: 'Other tariff' },
    });
    // On its own tariff this item would be refused: it stores no tier3.
    const foreignItem = await addTier1OnlyItem(s, otherTariff.id, 0);

    const res = await patchSelections(s, {
      selections: [{ itemId: foreignItem, tier: 'tier3', customPrice: null }],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 0 });
    expect(await readSelection(foreignItem)).toEqual(NO_SELECTION);
  });
});
