// Integration tests for PATCH .../advantage-tariffs/{id}/selections.
//
// Selections are persisted in one bulk update scoped to the tariff, so the
// interesting properties are: (1) the chosen star tier + custom price round-trip to
// the detail and the list's selectedCount, (2) an itemId from another tariff is
// silently skipped (updated: 0), (3) clearing sets the fields back, and (4) an
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
    await patchSelections(s, {
      selections: [{ itemId: s.item1, tier: 'tier2', customPrice: '50.00' }],
    });

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
});
