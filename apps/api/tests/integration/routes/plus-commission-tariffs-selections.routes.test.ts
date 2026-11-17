// Integration tests for PATCH .../plus-commission-tariffs/{id}/selections.
//
// Selections are persisted in one bulk update gated on the tariff's PERIODS, so the
// interesting properties are: (1) the boolean Plus opt-in + custom price round-trip
// to the detail and the list's selectedCount, (2) an itemId from another tariff (or
// another tariff's period) is silently skipped (updated: 0), (3) clearing sets
// the fields back, and (4) one request saves every item of the largest tariff a week
// can hold (MAX_TARIFF_ITEMS), while one item more is refused with 422 on `selections`.

import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { DEFAULT_ROW_CAP } from '@pazarsync/spreadsheet';

import { createApp } from '@/app';
import { createManyChunked } from '@/workbooks/import-rows';
import { MAX_TARIFF_ITEMS, MAX_TARIFF_PERIODS } from '@/workbooks/tariff-week';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

/** Seeding and saving the largest tariff writes tens of thousands of rows. */
const LARGEST_TARIFF_TIMEOUT_MS = 60_000;

interface Seeded {
  accessToken: string;
  orgId: string;
  storeId: string;
  tariffId: string;
  item1: string;
  item2: string;
}

/** Creates a Plus tariff + one period holding `barcodes.length` items. */
async function seedTariff(
  orgId: string,
  storeId: string,
  name: string,
  barcodes: ReadonlyArray<string>,
): Promise<{ tariffId: string; itemIds: string[] }> {
  const tariff = await prisma.plusCommissionTariff.create({
    data: { organizationId: orgId, storeId, name },
  });
  const period = await prisma.plusCommissionTariffPeriod.create({
    data: {
      organizationId: orgId,
      storeId,
      tariffId: tariff.id,
      dateRangeLabel: '30 Haziran - 7 Temmuz',
      sortOrder: 0,
    },
  });
  const itemIds: string[] = [];
  let sort = 0;
  for (const barcode of barcodes) {
    const item = await prisma.plusCommissionTariffItem.create({
      data: {
        organizationId: orgId,
        storeId,
        periodId: period.id,
        barcode,
        productTitle: 'Urun',
        currentPrice: '100.00',
        commissionBasePrice: '100.00',
        currentCommissionPct: '19',
        plusPriceUpperLimit: '90.00',
        plusCommissionPct: '15.4',
        plusCommissionBasePrice: '90.00',
        sortOrder: sort++,
      },
    });
    itemIds.push(item.id);
  }
  return { tariffId: tariff.id, itemIds };
}

async function seedTariffWithItems(): Promise<Seeded> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);
  // getPlusTariffDetail resolves fee definitions; restore them after truncateAll.
  await ensureFeeDefinitions();

  const { tariffId, itemIds } = await seedTariff(org.id, store.id, 'Plus Secim Testi', [
    'BC-1',
    'BC-2',
  ]);

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    tariffId,
    item1: itemIds[0] ?? '',
    item2: itemIds[1] ?? '',
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
      periods: { items: { id: string; selected: boolean; customPrice: string | null }[] }[];
    };
    const items = detail.periods[0]?.items ?? [];
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

  it("ignores another tariff's item in the SAME store (per-period gating, updated: 0)", async () => {
    const s = await seedTariffWithItems();
    // A second tariff (its own period + item) in the same store. Its item must NOT be
    // updatable through the first tariff's selections endpoint - the bulk UPDATE gates
    // on `period_id IN (periods of THIS tariff)`.
    const other = await seedTariff(s.orgId, s.storeId, 'Baska Plus Tarifesi', ['BC-OTHER']);
    const foreignItem = other.itemIds[0] ?? '';

    const res = await patchSelections(s, {
      selections: [{ itemId: foreignItem, selected: true, customPrice: '10.00' }],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(0);

    // The foreign item stays untouched.
    const row = await prisma.plusCommissionTariffItem.findUnique({ where: { id: foreignItem } });
    expect(row?.plusSelected).toBe(false);
    expect(row?.customPrice).toBeNull();
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

  // The largest tariff: MAX_TARIFF_PERIODS periods of DEFAULT_ROW_CAP items each. The
  // save binds three values per item in one UPDATE, so this is the case that proves
  // Postgres takes a full-size save.
  it(
    'saves every item of the largest tariff in one request',
    async () => {
      const seeded = await seedTariffWithItems();
      // A tariff of its own in the same store, holding exactly the largest week.
      const largest = await prisma.plusCommissionTariff.create({
        data: { organizationId: seeded.orgId, storeId: seeded.storeId, name: 'Largest tariff' },
      });
      const s = { ...seeded, tariffId: largest.id };
      const itemIds: string[] = [];
      for (let periodIndex = 0; periodIndex < MAX_TARIFF_PERIODS; periodIndex += 1) {
        const period = await prisma.plusCommissionTariffPeriod.create({
          data: {
            organizationId: s.orgId,
            storeId: s.storeId,
            tariffId: s.tariffId,
            dateRangeLabel: `Period ${(periodIndex + 1).toString()}`,
            sortOrder: periodIndex,
          },
        });
        const items = Array.from({ length: DEFAULT_ROW_CAP }, (_, row) => ({
          id: crypto.randomUUID(),
          organizationId: s.orgId,
          storeId: s.storeId,
          periodId: period.id,
          barcode: `BC-${row.toString()}`,
          productTitle: 'Urun',
          currentPrice: '100.00',
          commissionBasePrice: '100.00',
          currentCommissionPct: '19',
          plusPriceUpperLimit: '90.00',
          plusCommissionPct: '15.4',
          plusCommissionBasePrice: '90.00',
          sortOrder: row,
        }));
        await createManyChunked(items, (chunk) =>
          prisma.plusCommissionTariffItem.createMany({ data: chunk }),
        );
        itemIds.push(...items.map((item) => item.id));
      }
      expect(itemIds).toHaveLength(MAX_TARIFF_ITEMS);
      const stored = await prisma.plusCommissionTariffItem.count({
        where: { period: { tariffId: s.tariffId } },
      });
      expect(stored).toBe(MAX_TARIFF_ITEMS);

      const res = await patchSelections(s, {
        selections: itemIds.map((itemId) => ({ itemId, selected: true, customPrice: null })),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ updated: MAX_TARIFF_ITEMS });
      const selected = await prisma.plusCommissionTariffItem.count({
        where: { period: { tariffId: s.tariffId }, plusSelected: true },
      });
      expect(selected).toBe(MAX_TARIFF_ITEMS);
    },
    LARGEST_TARIFF_TIMEOUT_MS,
  );

  it('refuses one selection more than the largest tariff holds with 422 on selections', async () => {
    const s = await seedTariffWithItems();

    const res = await patchSelections(s, {
      selections: Array.from({ length: MAX_TARIFF_ITEMS + 1 }, () => ({
        itemId: crypto.randomUUID(),
        selected: false,
        customPrice: null,
      })),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; errors: { field: string }[] };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.map((issue) => issue.field)).toEqual(['selections']);
  });
});
