// Integration tests for PATCH .../commission-tariffs/{id}/selections.
//
// Selections are persisted in one bulk update scoped to the tariff, so the
// interesting properties are: (1) the chosen band + custom price round-trip to
// the detail and the list's selectedCount, (2) an itemId from another tariff is
// silently skipped (updated: 0), (3) clearing sets the fields back to null, and
// (4) a selection the export could not write -- a band the item does not store, or a
// band with no price (neither limit, unknown current price) without a custom price --
// refuses the whole request with 422 on `selections.<index>.band` and writes nothing.

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
  periodId: string;
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
    // The bands the cases select: band1 is open-topped (priced at its lower limit),
    // band2 and band3 are priced at their upper limits. band4 is never stored.
    bands: [
      { key: 'band1', lowerLimit: '100.00', commissionPct: '19' },
      { key: 'band2', upperLimit: '99.99', commissionPct: '17' },
      { key: 'band3', upperLimit: '89.99', commissionPct: '15' },
    ],
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
    periodId: period.id,
    item1: item1.id,
    item2: item2.id,
  };
}

/**
 * Adds an item whose current price is unknown (NULL) to the seeded period: its band1
 * has neither limit, so it has no price; its band2 keeps an upper limit, so it has one.
 */
async function createUnknownPriceItem(s: Seeded, barcode: string): Promise<string> {
  const item = await prisma.commissionTariffItem.create({
    data: {
      organizationId: s.orgId,
      storeId: s.storeId,
      periodId: s.periodId,
      barcode,
      productTitle: 'Unknown price product',
      currentPrice: null,
      currentCommissionPct: '19',
      bands: [
        { key: 'band1', commissionPct: '19' },
        { key: 'band2', upperLimit: '89.99', commissionPct: '15' },
      ],
    },
  });
  return item.id;
}

/** An item in a second tariff of the same store; it stores band1 only. */
async function createOtherTariffItem(s: Seeded): Promise<string> {
  const tariff = await prisma.commissionTariff.create({
    data: { organizationId: s.orgId, storeId: s.storeId, name: 'Other tariff' },
  });
  const period = await prisma.commissionTariffPeriod.create({
    data: {
      organizationId: s.orgId,
      storeId: s.storeId,
      tariffId: tariff.id,
      dateRangeLabel: '1 - 7 July',
      sortOrder: 0,
    },
  });
  const item = await prisma.commissionTariffItem.create({
    data: {
      organizationId: s.orgId,
      storeId: s.storeId,
      periodId: period.id,
      barcode: 'BC-OTHER',
      productTitle: 'Other tariff product',
      currentPrice: '100.00',
      currentCommissionPct: '19',
      bands: [{ key: 'band1', lowerLimit: '100.00', commissionPct: '19' }],
    },
  });
  return item.id;
}

async function readSelection(
  itemId: string,
): Promise<{ selectedBand: string | null; customPrice: string | null }> {
  const row = await prisma.commissionTariffItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { selectedBand: true, customPrice: true },
  });
  return {
    selectedBand: row.selectedBand,
    customPrice: row.customPrice === null ? null : row.customPrice.toFixed(2),
  };
}

const NO_SELECTION = { selectedBand: null, customPrice: null } as const;

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
    const saved = await patchSelections(s, {
      selections: [{ itemId: s.item1, band: 'band3', customPrice: '50.00' }],
    });
    expect(saved.status).toBe(200);

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

  it('refuses a custom price of 0 (422 INVALID_CUSTOM_PRICE) and writes nothing', async () => {
    const s = await seedTariffWithItems();
    // The bypass the rule closes: a band with no price, "rescued" by a custom price of 0.
    const unknownItem = await createUnknownPriceItem(s, 'BC-UNKNOWN');

    for (const customPrice of ['0', '0.0', '0.00', '000']) {
      const res = await patchSelections(s, {
        selections: [{ itemId: unknownItem, band: 'band1', customPrice }],
      });

      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        code: 'VALIDATION_ERROR',
        errors: [{ field: 'selections.0.customPrice', code: 'INVALID_CUSTOM_PRICE' }],
      });
      expect(await readSelection(unknownItem)).toEqual(NO_SELECTION);
    }

    // Control: the smallest real price is still accepted.
    const accepted = await patchSelections(s, {
      selections: [{ itemId: unknownItem, band: 'band1', customPrice: '0.01' }],
    });
    expect(accepted.status).toBe(200);
    expect(await readSelection(unknownItem)).toEqual({
      selectedBand: 'band1',
      customPrice: '0.01',
    });
  });

  it('refuses a band the item does not hold (422 BAND_NOT_STORED) and writes nothing', async () => {
    const s = await seedTariffWithItems();
    // A custom price does not waive the rule: the item stores no band4 at all.
    const res = await patchSelections(s, {
      selections: [{ itemId: s.item1, band: 'band4', customPrice: '79.90' }],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'selections.0.band', code: 'BAND_NOT_STORED' }],
    });
    expect(await readSelection(s.item1)).toEqual(NO_SELECTION);
  });

  it('refuses a band with neither limit when the current price is unknown and no custom price is sent (422 BAND_PRICE_UNKNOWN)', async () => {
    const s = await seedTariffWithItems();
    const unknownItem = await createUnknownPriceItem(s, 'BC-UNKNOWN');

    const res = await patchSelections(s, {
      selections: [{ itemId: unknownItem, band: 'band1', customPrice: null }],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'selections.0.band', code: 'BAND_PRICE_UNKNOWN' }],
    });
    expect(await readSelection(unknownItem)).toEqual(NO_SELECTION);
  });

  it('accepts a custom price on a band with neither limit when the current price is unknown', async () => {
    const s = await seedTariffWithItems();
    const unknownItem = await createUnknownPriceItem(s, 'BC-UNKNOWN');

    const res = await patchSelections(s, {
      selections: [{ itemId: unknownItem, band: 'band1', customPrice: '120.50' }],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 1 });
    expect(await readSelection(unknownItem)).toEqual({
      selectedBand: 'band1',
      customPrice: '120.50',
    });
  });

  it('accepts a limited band when the current price is unknown', async () => {
    const s = await seedTariffWithItems();
    const unknownItem = await createUnknownPriceItem(s, 'BC-UNKNOWN');

    const res = await patchSelections(s, {
      selections: [{ itemId: unknownItem, band: 'band2', customPrice: null }],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 1 });
    expect(await readSelection(unknownItem)).toEqual({ selectedBand: 'band2', customPrice: null });
  });

  it('refuses the whole request when one of several selections is invalid', async () => {
    const s = await seedTariffWithItems();
    const unknownItem = await createUnknownPriceItem(s, 'BC-UNKNOWN');

    // Index 0 is valid on its own; indexes 1 and 2 are each refused, and both are reported.
    const res = await patchSelections(s, {
      selections: [
        { itemId: s.item1, band: 'band2', customPrice: null },
        { itemId: s.item2, band: 'band4', customPrice: null },
        { itemId: unknownItem, band: 'band1', customPrice: null },
      ],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [
        { field: 'selections.1.band', code: 'BAND_NOT_STORED' },
        { field: 'selections.2.band', code: 'BAND_PRICE_UNKNOWN' },
      ],
    });
    expect(await readSelection(s.item1)).toEqual(NO_SELECTION);
    expect(await readSelection(s.item2)).toEqual(NO_SELECTION);
    expect(await readSelection(unknownItem)).toEqual(NO_SELECTION);
  });

  it('checks an upper-case item id like its lower-case form', async () => {
    const s = await seedTariffWithItems();
    // Postgres matches a uuid whatever its letter case, so the UPDATE would write this
    // row: the check must not skip it as out of scope.
    const res = await patchSelections(s, {
      selections: [{ itemId: s.item1.toUpperCase(), band: 'band4', customPrice: null }],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'selections.0.band', code: 'BAND_NOT_STORED' }],
    });
    expect(await readSelection(s.item1)).toEqual(NO_SELECTION);
  });

  it('still clears a selection to null on an item whose price is unknown', async () => {
    const s = await seedTariffWithItems();
    const unknownItem = await createUnknownPriceItem(s, 'BC-UNKNOWN');
    // A selection the route would refuse today, left by an older save: clearing it must
    // still work, since a null band is never checked.
    await prisma.commissionTariffItem.update({
      where: { id: unknownItem },
      data: { selectedBand: 'band1' },
    });

    const res = await patchSelections(s, {
      selections: [{ itemId: unknownItem, band: null, customPrice: null }],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 1 });
    expect(await readSelection(unknownItem)).toEqual(NO_SELECTION);
  });

  it('still ignores an item id from another tariff', async () => {
    const s = await seedTariffWithItems();
    const otherItem = await createOtherTariffItem(s);

    // band4 is not stored on the other item: the route must not check (or reveal) an item
    // outside this tariff, so it answers 200 and writes nothing.
    const res = await patchSelections(s, {
      selections: [{ itemId: otherItem, band: 'band4', customPrice: null }],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 0 });
    expect(await readSelection(otherItem)).toEqual(NO_SELECTION);
  });
});
