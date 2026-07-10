// Round-trip integration test for POST .../commission-tariffs/import using the
// REAL Trendyol "Ürün Komisyon Tarifeleri" export as a fixture. This proves the
// whole chain on the actual vendor format: the engine's bogus-<dimension> fix,
// positional column mapping (duplicate commission headers), period detection,
// barcode → variant matching, persistence, and on-read profit computation.
//
// One catalog variant matches a fixture barcode (TB200X300A) and is fully
// costed (TRY cost + SENDEOMP shipping + fee defs), so its bands compute; the
// remaining rows have no catalog product and report NO_PRODUCT.

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
  new URL('../../fixtures/trendyol-commission-tariff.xlsx', import.meta.url),
);
const MATCHED_BARCODE = 'TB200X300A';

interface ImportWire {
  tariffId: string;
  productCount: number;
  periodCount: number;
  itemCount: number;
  matched: number;
  unmatched: number;
  skippedRows: number;
}
interface BandWire {
  key: string;
  lowerLimit: string | null;
  upperLimit: string | null;
  price: string;
  commissionPct: string;
  netProfit: string | null;
}
interface DetailWire {
  periods: {
    dateRangeLabel: string;
    items: {
      barcode: string;
      commissionBasePrice: string | null;
      calculable: boolean;
      reason: string | null;
      bands: BandWire[];
    }[];
  }[];
}

interface Ctx {
  accessToken: string;
  orgId: string;
  storeId: string;
}

async function setupStoreWithMatch(): Promise<Ctx> {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  if (carrier === null) {
    throw new Error('SENDEOMP carrier missing — globalSetup ensureShippingReferenceData must run');
  }

  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Import Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'tariff-import-test',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 9101n,
      productMainId: 'pm-9101',
      title: '200x300 Cm Kumaş Türk Bayrağı',
      categoryId: 597n,
      categoryName: 'Bayrak',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 91010n,
      barcode: MATCHED_BARCODE,
      stockCode: MATCHED_BARCODE,
      salePrice: new Decimal('852.00'),
      listPrice: new Decimal('852.00'),
      vatRate: 20,
      dimensionalWeight: new Decimal('3.0'),
    },
  });

  const profile = await prisma.costProfile.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'COGS Test',
      type: 'COGS',
      amountGross: new Decimal('300.00'),
      currency: 'TRY',
      vatRate: 20,
      fxRateMode: 'MANUAL',
    },
  });
  await prisma.productVariantCostProfile.create({
    data: { organizationId: org.id, profileId: profile.id, productVariantId: variant.id },
  });
  await ensureFeeDefinitions();

  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id };
}

function importRequest(ctx: Ctx): Request {
  const form = new FormData();
  form.append('file', new Blob([FIXTURE]), 'trendyol-commission-tariff.xlsx');
  return new Request(
    `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/commission-tariffs/import`,
    { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
  );
}

describe('POST .../commission-tariffs/import — real Trendyol fixture', () => {
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

  it('imports every product row with one period and matches the catalog barcode', () => {
    expect(imported.productCount).toBeGreaterThan(50);
    expect(imported.periodCount).toBe(1);
    expect(imported.itemCount).toBe(imported.productCount);
    expect(imported.matched).toBe(1);
    expect(imported.unmatched).toBe(imported.productCount - 1);
    expect(imported.skippedRows).toBe(0);
  });

  it('assigns a sequential sortOrder reflecting the Excel row order', async () => {
    const items = await prisma.commissionTariffItem.findMany({
      where: { storeId: ctx.storeId },
      orderBy: { sortOrder: 'asc' },
      select: { sortOrder: true },
    });
    // 0-based, gap-free, one per row — proves the import numbers products by file order
    // (not all defaulting to 0, which would leave the detail order non-deterministic).
    expect(items.map((i) => i.sortOrder)).toEqual(items.map((_row, index) => index));
  });

  it('computes per-band profit for the matched product and NO_PRODUCT for the rest', async () => {
    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/commission-tariffs/${imported.tariffId}`,
      { headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire;

    expect(body.periods).toHaveLength(1);
    const period = body.periods[0];
    expect(period?.dateRangeLabel).toContain('Haziran');

    const matched = period?.items.find((i) => i.barcode === MATCHED_BARCODE);
    expect(matched?.calculable).toBe(true);
    expect(matched?.reason).toBeNull();
    // The "KOMİSYONA ESAS FİYAT" column was read from the real vendor file (852.0 for
    // this row) — byte-level proof the layout's search string matches the header.
    expect(matched?.commissionBasePrice).toBe('852.00');
    // Four bands, each with a non-null computed profit. The 4-day commissions are
    // 19 / 13.1 / 12.1 / 10.6 percent (read positionally past the duplicate headers).
    expect(matched?.bands).toHaveLength(4);
    expect(matched?.bands.map((b) => b.commissionPct)).toEqual(['19', '13.1', '12.1', '10.6']);
    for (const band of matched?.bands ?? []) {
      expect(band.netProfit).not.toBeNull();
    }

    const unmatched = period?.items.find((i) => i.barcode !== MATCHED_BARCODE);
    expect(unmatched?.calculable).toBe(false);
    expect(unmatched?.reason).toBe('NO_PRODUCT');
  });
});
