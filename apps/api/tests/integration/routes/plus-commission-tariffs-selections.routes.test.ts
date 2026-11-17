// Integration tests for PATCH .../plus-commission-tariffs/{id}/selections.
//
// Selections are persisted in one bulk update gated on the tariff's PERIODS, so the
// interesting properties are: (1) the boolean Plus opt-in + custom price round-trip
// to the detail and the list's selectedCount, (2) an itemId from another tariff (or
// another tariff's period) is silently skipped (updated: 0), (3) clearing sets
// the fields back, (4) a join the export could not write -- selected without a custom
// price on an item whose Plus price upper limit is unknown -- refuses the whole request
// with 422 PLUS_PRICE_UNKNOWN on `selections.<index>.selected` and writes nothing, as does
// any join on an item whose Plus commission offer is unknown (PLUS_COMMISSION_UNKNOWN, also
// with a custom price), and a custom price of 0 is refused, and (5) one request saves every
// item of the largest
// tariff a week can hold (MAX_TARIFF_ITEMS), while one item more is refused with 422 on
// `selections`.

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
  periodId: string;
  item1: string;
  item2: string;
}

/**
 * Creates a Plus tariff + one period holding `barcodes.length` items. Every item has
 * the given Plus price upper limit; null is an item whose ceiling is unknown.
 */
async function seedTariff(
  orgId: string,
  storeId: string,
  name: string,
  barcodes: ReadonlyArray<string>,
  plusPriceUpperLimit: string | null = '90.00',
): Promise<{ tariffId: string; periodId: string; itemIds: string[] }> {
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
        plusPriceUpperLimit,
        plusCommissionPct: '15.4',
        plusCommissionBasePrice: plusPriceUpperLimit,
        sortOrder: sort++,
      },
    });
    itemIds.push(item.id);
  }
  return { tariffId: tariff.id, periodId: period.id, itemIds };
}

async function seedTariffWithItems(): Promise<Seeded> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);
  // getPlusTariffDetail resolves fee definitions; restore them after truncateAll.
  await ensureFeeDefinitions();

  const { tariffId, periodId, itemIds } = await seedTariff(org.id, store.id, 'Plus Secim Testi', [
    'BC-1',
    'BC-2',
  ]);

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    tariffId,
    periodId,
    item1: itemIds[0] ?? '',
    item2: itemIds[1] ?? '',
  };
}

/** Adds an item whose Plus price upper limit is unknown (NULL) to the seeded period. */
async function createUnknownCeilingItem(s: Seeded, barcode: string): Promise<string> {
  const item = await prisma.plusCommissionTariffItem.create({
    data: {
      organizationId: s.orgId,
      storeId: s.storeId,
      periodId: s.periodId,
      barcode,
      productTitle: 'Unknown ceiling product',
      currentPrice: '100.00',
      commissionBasePrice: '100.00',
      currentCommissionPct: '19',
      plusPriceUpperLimit: null,
      plusCommissionPct: '15.4',
      plusCommissionBasePrice: null,
      sortOrder: 0,
    },
  });
  return item.id;
}

/**
 * Adds an item whose Plus commission offer is unknown (NULL) to the seeded period. Its
 * Plus price upper limit is known unless null is passed.
 */
async function createUnknownCommissionItem(
  s: Seeded,
  barcode: string,
  plusPriceUpperLimit: string | null = '90.00',
): Promise<string> {
  const item = await prisma.plusCommissionTariffItem.create({
    data: {
      organizationId: s.orgId,
      storeId: s.storeId,
      periodId: s.periodId,
      barcode,
      productTitle: 'Unknown commission product',
      currentPrice: '100.00',
      commissionBasePrice: '100.00',
      currentCommissionPct: '19',
      plusPriceUpperLimit,
      plusCommissionPct: null,
      plusCommissionBasePrice: plusPriceUpperLimit,
      sortOrder: 0,
    },
  });
  return item.id;
}

async function readSelection(
  itemId: string,
): Promise<{ plusSelected: boolean; customPrice: string | null }> {
  const row = await prisma.plusCommissionTariffItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { plusSelected: true, customPrice: true },
  });
  return {
    plusSelected: row.plusSelected,
    // The stored Decimal as its 2-dp text, so the assertions read like the request.
    customPrice: row.customPrice === null ? null : row.customPrice.toFixed(2),
  };
}

const NO_SELECTION = { plusSelected: false, customPrice: null };

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

  it('rejects a custom price of 0 (422 INVALID_CUSTOM_PRICE)', async () => {
    const s = await seedTariffWithItems();
    // The bypass the rule closes: a join on an unknown ceiling, "rescued" by a custom
    // price of 0, would export 0.00.
    const unknownItem = await createUnknownCeilingItem(s, 'BC-UNKNOWN');

    for (const customPrice of ['0', '0.0', '0.00', '000']) {
      const res = await patchSelections(s, {
        selections: [{ itemId: unknownItem, selected: true, customPrice }],
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
      selections: [{ itemId: unknownItem, selected: true, customPrice: '0.01' }],
    });
    expect(accepted.status).toBe(200);
    expect(await readSelection(unknownItem)).toEqual({ plusSelected: true, customPrice: '0.01' });
  });

  it('refuses a join without a custom price when the Plus price ceiling is unknown (422 PLUS_PRICE_UNKNOWN on selections.0.selected) and writes nothing', async () => {
    const s = await seedTariffWithItems();
    const unknownItem = await createUnknownCeilingItem(s, 'BC-UNKNOWN');

    const res = await patchSelections(s, {
      selections: [{ itemId: unknownItem, selected: true, customPrice: null }],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'selections.0.selected', code: 'PLUS_PRICE_UNKNOWN' }],
    });
    expect(await readSelection(unknownItem)).toEqual(NO_SELECTION);
  });

  it('accepts a join with a custom price when the Plus price ceiling is unknown', async () => {
    const s = await seedTariffWithItems();
    const unknownItem = await createUnknownCeilingItem(s, 'BC-UNKNOWN');

    const res = await patchSelections(s, {
      selections: [{ itemId: unknownItem, selected: true, customPrice: '120.50' }],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 1 });
    expect(await readSelection(unknownItem)).toEqual({ plusSelected: true, customPrice: '120.50' });
  });

  it('refuses the whole request when one of several selections is invalid, and reports each by its request index', async () => {
    const s = await seedTariffWithItems();
    const unknownJoin = await createUnknownCeilingItem(s, 'BC-UNKNOWN-1');
    const unknownCleared = await createUnknownCeilingItem(s, 'BC-UNKNOWN-2');
    const unknownCustom = await createUnknownCeilingItem(s, 'BC-UNKNOWN-3');
    const unknownJoinLast = await createUnknownCeilingItem(s, 'BC-UNKNOWN-4');
    // A join left by an older save: the clearing entry at index 2 must not be written.
    await prisma.plusCommissionTariffItem.update({
      where: { id: unknownCleared },
      data: { plusSelected: true, customPrice: '50.00' },
    });

    // Indexes 0, 2 and 3 are valid on their own (a known ceiling, a clear, a custom
    // price); indexes 1 and 4 are each refused, and both are reported.
    const res = await patchSelections(s, {
      selections: [
        { itemId: s.item1, selected: true, customPrice: null },
        { itemId: unknownJoin, selected: true, customPrice: null },
        { itemId: unknownCleared, selected: false, customPrice: null },
        { itemId: unknownCustom, selected: true, customPrice: '120.50' },
        { itemId: unknownJoinLast, selected: true, customPrice: null },
      ],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [
        { field: 'selections.1.selected', code: 'PLUS_PRICE_UNKNOWN' },
        { field: 'selections.4.selected', code: 'PLUS_PRICE_UNKNOWN' },
      ],
    });
    expect(await readSelection(s.item1)).toEqual(NO_SELECTION);
    expect(await readSelection(unknownJoin)).toEqual(NO_SELECTION);
    expect(await readSelection(unknownCleared)).toEqual({
      plusSelected: true,
      customPrice: '50.00',
    });
    expect(await readSelection(unknownCustom)).toEqual(NO_SELECTION);
    expect(await readSelection(unknownJoinLast)).toEqual(NO_SELECTION);
  });

  it('checks an item id sent in upper case', async () => {
    const s = await seedTariffWithItems();
    const unknownItem = await createUnknownCeilingItem(s, 'BC-UNKNOWN');
    // Postgres matches a uuid whatever its letter case, so the UPDATE would write this
    // row: the check must not skip it as out of scope.
    const res = await patchSelections(s, {
      selections: [{ itemId: unknownItem.toUpperCase(), selected: true, customPrice: null }],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'selections.0.selected', code: 'PLUS_PRICE_UNKNOWN' }],
    });
    expect(await readSelection(unknownItem)).toEqual(NO_SELECTION);
  });

  it('still clears a join on an item whose ceiling is unknown', async () => {
    const s = await seedTariffWithItems();
    const unknownItem = await createUnknownCeilingItem(s, 'BC-UNKNOWN');
    // A join the route would refuse today, left by an older save: clearing it must still
    // work, since a `selected: false` entry is never checked.
    await prisma.plusCommissionTariffItem.update({
      where: { id: unknownItem },
      data: { plusSelected: true },
    });

    const res = await patchSelections(s, {
      selections: [{ itemId: unknownItem, selected: false, customPrice: null }],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 1 });
    expect(await readSelection(unknownItem)).toEqual(NO_SELECTION);
  });

  it('still ignores an item id from another tariff', async () => {
    const s = await seedTariffWithItems();
    // An item of a second tariff in the same store whose ceiling is unknown: on an own
    // item this join would be refused, so the route must not check (or reveal) it. It
    // answers 200 and writes nothing.
    const other = await seedTariff(s.orgId, s.storeId, 'Other Plus tariff', ['BC-OTHER'], null);
    const otherItem = other.itemIds[0] ?? '';

    const res = await patchSelections(s, {
      selections: [{ itemId: otherItem, selected: true, customPrice: null }],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 0 });
    expect(await readSelection(otherItem)).toEqual(NO_SELECTION);
  });

  // The export writes the stored Plus commission offer of every joined item, so a join on
  // an item whose offer is unknown is refused, whatever the price: a custom price does
  // not supply the commission.
  describe('a join on an item whose Plus commission is unknown', () => {
    it('refuses a join on an item whose Plus commission is unknown (422 PLUS_COMMISSION_UNKNOWN on selections.0.selected) and writes nothing', async () => {
      const s = await seedTariffWithItems();
      const unknownItem = await createUnknownCommissionItem(s, 'BC-UNKNOWN-PCT');

      const res = await patchSelections(s, {
        selections: [{ itemId: unknownItem, selected: true, customPrice: null }],
      });

      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        code: 'VALIDATION_ERROR',
        errors: [{ field: 'selections.0.selected', code: 'PLUS_COMMISSION_UNKNOWN' }],
      });
      expect(await readSelection(unknownItem)).toEqual(NO_SELECTION);
    });

    it('refuses it also with a custom price', async () => {
      const s = await seedTariffWithItems();
      const unknownItem = await createUnknownCommissionItem(s, 'BC-UNKNOWN-PCT');

      const res = await patchSelections(s, {
        selections: [{ itemId: unknownItem, selected: true, customPrice: '120.50' }],
      });

      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        code: 'VALIDATION_ERROR',
        errors: [{ field: 'selections.0.selected', code: 'PLUS_COMMISSION_UNKNOWN' }],
      });
      expect(await readSelection(unknownItem)).toEqual(NO_SELECTION);
    });

    it('still clears a join on such an item', async () => {
      const s = await seedTariffWithItems();
      const unknownItem = await createUnknownCommissionItem(s, 'BC-UNKNOWN-PCT');
      // A join the route refuses today, left by an older save: clearing it must still
      // work, since a `selected: false` entry is never checked.
      await prisma.plusCommissionTariffItem.update({
        where: { id: unknownItem },
        data: { plusSelected: true, customPrice: '50.00' },
      });

      const res = await patchSelections(s, {
        selections: [{ itemId: unknownItem, selected: false, customPrice: null }],
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ updated: 1 });
      expect(await readSelection(unknownItem)).toEqual(NO_SELECTION);
    });

    it('reports each refused selection by its request index, mixing both codes', async () => {
      const s = await seedTariffWithItems();
      const unknownPct = await createUnknownCommissionItem(s, 'BC-UNKNOWN-PCT');
      const unknownCeiling = await createUnknownCeilingItem(s, 'BC-UNKNOWN-CEILING');
      const unknownBoth = await createUnknownCommissionItem(s, 'BC-UNKNOWN-BOTH', null);
      const unknownCeilingCustom = await createUnknownCeilingItem(s, 'BC-UNKNOWN-CEILING-2');
      const unknownPctCustom = await createUnknownCommissionItem(s, 'BC-UNKNOWN-PCT-2');
      const unknownPctCleared = await createUnknownCommissionItem(s, 'BC-UNKNOWN-PCT-3');
      // A join left by an older save: the clearing entry at index 6 must not be written.
      await prisma.plusCommissionTariffItem.update({
        where: { id: unknownPctCleared },
        data: { plusSelected: true, customPrice: '50.00' },
      });

      // Indexes 0, 4 and 6 are valid on their own (both known, a custom price on an
      // unknown ceiling, a clear). Index 3 has both unknown and gets one issue: the
      // commission, which a custom price could not fix either.
      const res = await patchSelections(s, {
        selections: [
          { itemId: s.item1, selected: true, customPrice: null },
          { itemId: unknownPct, selected: true, customPrice: null },
          { itemId: unknownCeiling, selected: true, customPrice: null },
          { itemId: unknownBoth, selected: true, customPrice: null },
          { itemId: unknownCeilingCustom, selected: true, customPrice: '120.50' },
          { itemId: unknownPctCustom, selected: true, customPrice: '120.50' },
          { itemId: unknownPctCleared, selected: false, customPrice: null },
        ],
      });

      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        code: 'VALIDATION_ERROR',
        errors: [
          { field: 'selections.1.selected', code: 'PLUS_COMMISSION_UNKNOWN' },
          { field: 'selections.2.selected', code: 'PLUS_PRICE_UNKNOWN' },
          { field: 'selections.3.selected', code: 'PLUS_COMMISSION_UNKNOWN' },
          { field: 'selections.5.selected', code: 'PLUS_COMMISSION_UNKNOWN' },
        ],
      });
      for (const itemId of [
        s.item1,
        unknownPct,
        unknownCeiling,
        unknownBoth,
        unknownCeilingCustom,
        unknownPctCustom,
      ]) {
        expect(await readSelection(itemId)).toEqual(NO_SELECTION);
      }
      expect(await readSelection(unknownPctCleared)).toEqual({
        plusSelected: true,
        customPrice: '50.00',
      });
    });

    it('checks an item id sent in upper case', async () => {
      const s = await seedTariffWithItems();
      const unknownItem = await createUnknownCommissionItem(s, 'BC-UNKNOWN-PCT');
      // Postgres matches a uuid whatever its letter case, so the UPDATE would write this
      // row: the check must not skip it as out of scope.
      const res = await patchSelections(s, {
        selections: [{ itemId: unknownItem.toUpperCase(), selected: true, customPrice: '120.50' }],
      });

      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        code: 'VALIDATION_ERROR',
        errors: [{ field: 'selections.0.selected', code: 'PLUS_COMMISSION_UNKNOWN' }],
      });
      expect(await readSelection(unknownItem)).toEqual(NO_SELECTION);
    });
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
