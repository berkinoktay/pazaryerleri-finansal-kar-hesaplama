// Integration tests for PATCH .../plus-commission-tariffs/{id}/selections.
//
// Selections are persisted in one bulk update scoped to the tariff, so the
// interesting properties are: (1) the boolean Plus opt-in + custom price round-trip
// to the detail and the list's selectedCount, (2) an itemId from another tariff is
// silently skipped (updated: 0), and (3) clearing sets the fields back.

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
  // getPlusTariffDetail resolves fee definitions; restore them after truncateAll.
  await ensureFeeDefinitions();

  const tariff = await prisma.plusCommissionTariff.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'Plus Secim Testi',
      dateRangeLabel: '30 Haziran - 7 Temmuz',
    },
  });
  const baseItem = {
    organizationId: org.id,
    storeId: store.id,
    tariffId: tariff.id,
    productTitle: 'Urun',
    currentPrice: '100.00',
    commissionBasePrice: '100.00',
    currentCommissionPct: '19',
    plusPriceUpperLimit: '90.00',
    plusCommissionPct: '15.4',
    plusCommissionBasePrice: '90.00',
  };
  const item1 = await prisma.plusCommissionTariffItem.create({
    data: { ...baseItem, barcode: 'BC-1', sortOrder: 0 },
  });
  const item2 = await prisma.plusCommissionTariffItem.create({
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
    `/v1/organizations/${s.orgId}/stores/${s.storeId}/plus-commission-tariffs/${s.tariffId}/selections`,
    {
      method: 'PATCH',
      headers: { Authorization: bearer(s.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

describe('PATCH .../plus-commission-tariffs/{id}/selections', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('saves the Plus opt-in + custom price and reflects it in detail and the list count', async () => {
    const s = await seedTariffWithItems();

    const res = await patchSelections(s, {
      selections: [{ itemId: s.item1, selected: true, customPrice: '199.90' }],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(1);

    const detail = (await (
      await app.request(
        `/v1/organizations/${s.orgId}/stores/${s.storeId}/plus-commission-tariffs/${s.tariffId}`,
        { headers: { Authorization: bearer(s.accessToken) } },
      )
    ).json()) as {
      items: { id: string; selected: boolean; customPrice: string | null }[];
    };
    const items = detail.items;
    expect(items.find((i) => i.id === s.item1)?.selected).toBe(true);
    expect(items.find((i) => i.id === s.item1)?.customPrice).toBe('199.90');
    expect(items.find((i) => i.id === s.item2)?.selected).toBe(false);

    const list = (await (
      await app.request(
        `/v1/organizations/${s.orgId}/stores/${s.storeId}/plus-commission-tariffs`,
        {
          headers: { Authorization: bearer(s.accessToken) },
        },
      )
    ).json()) as { data: { selectedCount: number }[] };
    expect(list.data[0]?.selectedCount).toBe(1);
  });

  it('ignores an itemId that does not belong to the tariff (updated: 0)', async () => {
    const s = await seedTariffWithItems();
    const res = await patchSelections(s, {
      selections: [{ itemId: crypto.randomUUID(), selected: true, customPrice: null }],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(0);
  });

  it('clears a selection back to not-opted-in with null custom price', async () => {
    const s = await seedTariffWithItems();
    await patchSelections(s, {
      selections: [{ itemId: s.item1, selected: true, customPrice: '50.00' }],
    });

    const res = await patchSelections(s, {
      selections: [{ itemId: s.item1, selected: false, customPrice: null }],
    });
    expect(res.status).toBe(200);

    const row = await prisma.plusCommissionTariffItem.findUnique({ where: { id: s.item1 } });
    expect(row?.plusSelected).toBe(false);
    expect(row?.customPrice).toBeNull();
  });

  it('rejects an invalid custom price (422)', async () => {
    const s = await seedTariffWithItems();
    const res = await patchSelections(s, {
      selections: [{ itemId: s.item1, selected: true, customPrice: 'not-a-price' }],
    });
    expect(res.status).toBe(422);
  });
});
