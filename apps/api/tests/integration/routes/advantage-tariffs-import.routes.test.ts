// Round-trip integration test for POST .../advantage-tariffs/import using the real
// Trendyol "Avantajlı Ürün Etiketleri" export as a fixture, then the cross-vertical
// commission read on the imported tariff.
//
// This is the KEY test of the vertical: it proves the whole chain on the actual
// vendor sheet (sheet `YıldızlıÜrünEtiketleri`) — header-name column mapping, the
// three star-tier price thresholds, barcode → variant matching, persistence — AND
// the ONE structural novelty: the reduced commission per tier is READ from the
// store's separate Commission Tariff. One catalog variant matches a fixture barcode
// (TB100X150A, fully costed: TRY cost + SENDEOMP shipping + fee defs) and a
// commission tariff whose ACTIVE period holds bands covering that product's tier
// prices, so its tiers resolve their commission from a band.

import { readFileSync } from 'node:fs';

import { Decimal } from 'decimal.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

const FIXTURE = readFileSync(
  new URL(
    '../../../../../docs/excel-examples/trendyol_avantajli_urun_etiketleri.xlsx',
    import.meta.url,
  ),
);
// First data row of the real export: "Var", tier prices 292,91 / 274,42 / 223,78,
// current sale price 360,00.
const MATCHED_BARCODE = 'TB100X150A';

// Bands covering the matched product's three tier prices + current price:
//   current 360.00 → band1 (19)   ·  tier1 292.91 → band2 (13.1)
//   tier2   274.42 → band3 (11.5) ·  tier3 223.78 → band4 (8.8)
const MATCHED_BANDS = [
  { key: 'band1', lowerLimit: '300.00', commissionPct: '19' },
  { key: 'band2', lowerLimit: '280.00', upperLimit: '299.99', commissionPct: '13.1' },
  { key: 'band3', lowerLimit: '250.00', upperLimit: '279.99', commissionPct: '11.5' },
  { key: 'band4', upperLimit: '249.99', commissionPct: '8.8' },
];

interface ImportWire {
  tariffId: string;
  productCount: number;
  itemCount: number;
  matched: number;
  unmatched: number;
  skippedRows: number;
}
interface TierWire {
  key: string;
  commissionPct: string | null;
  commissionSource: 'band' | 'category' | null;
  netProfit: string | null;
}
interface DetailWire {
  commissionSourceMode: 'pinned' | 'category';
  commissionSource: { tariffId: string; periodLabel: string } | null;
  items: {
    barcode: string;
    calculable: boolean;
    reason: string | null;
    current: { netProfit: string | null; isBest: boolean };
    tiers: TierWire[];
    bestTierKey: string | null;
  }[];
}

interface Ctx {
  accessToken: string;
  orgId: string;
  storeId: string;
  commissionTariffId: string;
}

async function setupStoreWithMatch(): Promise<Ctx> {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  if (carrier === null) {
    throw new Error('SENDEOMP carrier missing - globalSetup ensureShippingReferenceData must run');
  }

  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Advantage Import Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'advantage-tariff-import-test',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 9501n,
      productMainId: 'pm-9501',
      title: 'Türk Bayrağı',
      categoryId: 597n,
      categoryName: 'Bayrak',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 95010n,
      barcode: MATCHED_BARCODE,
      stockCode: MATCHED_BARCODE,
      salePrice: new Decimal('360.00'),
      listPrice: new Decimal('360.00'),
      vatRate: 20,
      dimensionalWeight: new Decimal('3.0'),
    },
  });

  const profile = await prisma.costProfile.create({
    data: {
      organizationId: org.id,
      name: 'COGS Test',
      type: 'COGS',
      amountGross: new Decimal('200.00'),
      currency: 'TRY',
      vatRate: 20,
      fxRateMode: 'MANUAL',
    },
  });
  await prisma.productVariantCostProfile.create({
    data: { organizationId: org.id, profileId: profile.id, productVariantId: variant.id },
  });
  await ensureFeeDefinitions();

  // Commission Tariff whose active period supplies the reduced rates (band read).
  const commissionTariff = await prisma.commissionTariff.create({
    data: { organizationId: org.id, storeId: store.id, name: 'Temmuz Komisyon Tarifesi' },
  });
  const now = Date.now();
  const period = await prisma.commissionTariffPeriod.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      tariffId: commissionTariff.id,
      dateRangeLabel: '7 - 14 Temmuz',
      startsAt: new Date(now - 86_400_000),
      endsAt: new Date(now + 86_400_000),
      sortOrder: 0,
    },
  });
  await prisma.commissionTariffItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      periodId: period.id,
      productVariantId: variant.id,
      barcode: MATCHED_BARCODE,
      stockCode: MATCHED_BARCODE,
      productTitle: 'Türk Bayrağı',
      currentPrice: '360.00',
      currentCommissionPct: '0.1900',
      bands: MATCHED_BANDS,
    },
  });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    commissionTariffId: commissionTariff.id,
  };
}

function importRequest(ctx: Ctx): Request {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(FIXTURE)]),
    'trendyol_avantajli_urun_etiketleri.xlsx',
  );
  // Pin the commission tariff (week) at upload — the seller's explicit choice of
  // which commission tariff supplies the reduced rates (no silent auto-resolution).
  form.append('commissionSourceTariffId', ctx.commissionTariffId);
  return new Request(
    `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/advantage-tariffs/import`,
    { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
  );
}

describe('POST .../advantage-tariffs/import - real Trendyol fixture + commission read', () => {
  let ctx: Ctx;
  let imported: ImportWire;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    ctx = await setupStoreWithMatch();

    const res = await app.request(importRequest(ctx));
    expect(res.status).toBe(201);
    imported = (await res.json()) as ImportWire;
  });

  it('imports every product row and matches the catalog barcode', async () => {
    expect(imported.productCount).toBeGreaterThan(0);
    expect(imported.itemCount).toBe(imported.productCount);
    expect(imported.matched).toBe(1);
    expect(imported.unmatched).toBe(imported.productCount - 1);
    expect(imported.skippedRows).toBeGreaterThanOrEqual(0);

    // A tariff + one item per product row were persisted (raw file kept for export).
    const tariff = await prisma.advantageTariff.findUnique({
      where: { id: imported.tariffId },
      select: { storeId: true, sourceFile: true },
    });
    expect(tariff?.storeId).toBe(ctx.storeId);
    expect(tariff?.sourceFile).not.toBeNull();
    const itemCount = await prisma.advantageTariffItem.count({
      where: { tariffId: imported.tariffId },
    });
    expect(itemCount).toBe(imported.itemCount);
  });

  it('reads each tier commission from the commission tariff band for the matched product', async () => {
    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/advantage-tariffs/${imported.tariffId}`,
      { headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire;

    // The pinned commission tariff supplied the rates, surfaced so the seller can
    // confirm the periods align.
    expect(body.commissionSourceMode).toBe('pinned');
    expect(body.commissionSource?.tariffId).toBe(ctx.commissionTariffId);
    expect(body.commissionSource?.periodLabel).toBe('7 - 14 Temmuz');

    const matched = body.items.find((i) => i.barcode === MATCHED_BARCODE);
    expect(matched?.calculable).toBe(true);
    expect(matched?.reason).toBeNull();
    expect(matched?.current.netProfit).not.toBeNull();
    // "En kârlı" spans the baseline + tiers, and the two flags are mutually exclusive —
    // never a tier AND the current baseline at once. (The exhaustive per-case selection
    // logic is covered in tests/unit/advantage-tariff-best-selection.test.ts.)
    expect(matched?.current.isBest && matched?.bestTierKey !== null).toBe(false);
    // Every tier's reduced commission came from a band and produced a real profit.
    for (const tier of matched?.tiers ?? []) {
      expect(tier.commissionSource).toBe('band');
      expect(tier.commissionPct).not.toBeNull();
      expect(tier.netProfit).not.toBeNull();
    }
    // The three tier prices landed in the three lower bands (13.1 / 11.5 / 8.8).
    // commissionPct is serialized at 4-decimal precision (matching the commission-tariff
    // vertical), so the full applied rate is preserved on the wire.
    expect(matched?.tiers.map((t) => t.commissionPct)).toEqual(['13.1000', '11.5000', '8.8000']);

    // An unmatched product (no catalog variant) is not calculable.
    const unmatched = body.items.find((i) => i.barcode !== MATCHED_BARCODE);
    expect(unmatched?.calculable).toBe(false);
    expect(unmatched?.reason).toBe('NO_PRODUCT');
  });
});
