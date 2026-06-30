// Integration tests for PATCH .../commission-tariffs/{id}/selections.
//
// Selections are persisted in one bulk update scoped to the tariff, so the
// interesting properties are: (1) the chosen band + custom price round-trip to
// the detail and the list's selectedCount, (2) an itemId from another tariff is
// silently skipped (updated: 0), and (3) clearing sets the fields back to null.

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
  // getTariffDetail resolves fee definitions; restore them after truncateAll.
  await ensureFeeDefinitions();

  const tariff = await prisma.commissionTariff.create({
    data: { organizationId: org.id, storeId: store.id, name: 'Seçim Testi' },
  });
  const period = await prisma.commissionTariffPeriod.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      tariffId: tariff.id,
      dateRangeLabel: '23 – 26 Haziran',
      sortOrder: 0,
    },
  });
  const baseItem = {
    organizationId: org.id,
    storeId: store.id,
    periodId: period.id,
    productTitle: 'Ürün',
    currentPrice: '100.00',
    currentCommissionPct: '19',
    bands: [{ key: 'band1', upperLimit: '100.00', commissionPct: '19' }],
  };
  const item1 = await prisma.commissionTariffItem.create({
    data: { ...baseItem, barcode: 'BC-1' },
  });
  const item2 = await prisma.commissionTariffItem.create({
    data: { ...baseItem, barcode: 'BC-2' },
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
    `/v1/organizations/${s.orgId}/stores/${s.storeId}/commission-tariffs/${s.tariffId}/selections`,
    {
      method: 'PATCH',
      headers: { Authorization: bearer(s.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

describe('PATCH .../commission-tariffs/{id}/selections', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('saves a band + custom price and reflects it in detail and the list count', async () => {
    const s = await seedTariffWithItems();

    const res = await patchSelections(s, {
      selections: [{ itemId: s.item1, band: 'band2', customPrice: '199.90' }],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(1);

    const detail = (await (
      await app.request(
        `/v1/organizations/${s.orgId}/stores/${s.storeId}/commission-tariffs/${s.tariffId}`,
        { headers: { Authorization: bearer(s.accessToken) } },
      )
    ).json()) as {
      periods: {
        items: { id: string; selectedBand: string | null; customPrice: string | null }[];
      }[];
    };
    const items = detail.periods[0]?.items ?? [];
    expect(items.find((i) => i.id === s.item1)?.selectedBand).toBe('band2');
    expect(items.find((i) => i.id === s.item1)?.customPrice).toBe('199.90');
    expect(items.find((i) => i.id === s.item2)?.selectedBand).toBeNull();

    const list = (await (
      await app.request(`/v1/organizations/${s.orgId}/stores/${s.storeId}/commission-tariffs`, {
        headers: { Authorization: bearer(s.accessToken) },
      })
    ).json()) as { data: { selectedCount: number }[] };
    expect(list.data[0]?.selectedCount).toBe(1);
  });

  it('ignores an itemId that does not belong to the tariff (updated: 0)', async () => {
    const s = await seedTariffWithItems();
    const res = await patchSelections(s, {
      selections: [{ itemId: crypto.randomUUID(), band: 'band1', customPrice: null }],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(0);
  });

  it('clears a selection back to null', async () => {
    const s = await seedTariffWithItems();
    await patchSelections(s, {
      selections: [{ itemId: s.item1, band: 'band3', customPrice: '50.00' }],
    });

    const res = await patchSelections(s, {
      selections: [{ itemId: s.item1, band: null, customPrice: null }],
    });
    expect(res.status).toBe(200);

    const row = await prisma.commissionTariffItem.findUnique({ where: { id: s.item1 } });
    expect(row?.selectedBand).toBeNull();
    expect(row?.customPrice).toBeNull();
  });

  it('rejects an invalid custom price (422)', async () => {
    const s = await seedTariffWithItems();
    const res = await patchSelections(s, {
      selections: [{ itemId: s.item1, band: 'band1', customPrice: 'not-a-price' }],
    });
    expect(res.status).toBe(422);
  });
});
