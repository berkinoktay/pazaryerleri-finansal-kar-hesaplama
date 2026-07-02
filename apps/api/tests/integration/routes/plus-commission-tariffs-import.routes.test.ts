// Round-trip integration test for POST .../plus-commission-tariffs/import using
// the real Trendyol "Plus Komisyon" export as a fixture. This proves the whole
// chain on the actual vendor sheet layout: header-name column mapping, the single
// 7-day period, barcode -> variant matching, persistence, and on-read profit.
//
// One catalog variant matches a fixture barcode (85697423698) and is fully costed
// (TRY cost + SENDEOMP shipping + fee defs), so its scenarios compute; the
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

const FIXTURE = readFileSync(new URL('../../fixtures/trendyol-plus-tariff.xlsx', import.meta.url));
const MATCHED_BARCODE = '85697423698';

interface ImportWire {
  tariffId: string;
  productCount: number;
  itemCount: number;
  matched: number;
  unmatched: number;
  skippedRows: number;
}
interface ScenarioWire {
  price: string;
  commissionPct: string;
  netProfit: string | null;
  marginPct: string | null;
}
interface DetailWire {
  dateRangeLabel: string;
  items: {
    barcode: string;
    calculable: boolean;
    reason: string | null;
    current: ScenarioWire;
    plus: ScenarioWire;
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
    throw new Error('SENDEOMP carrier missing - globalSetup ensureShippingReferenceData must run');
  }

  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Plus Import Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'plus-tariff-import-test',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 9301n,
      productMainId: 'pm-9301',
      title: 'Turk Bayragi',
      categoryId: 597n,
      categoryName: 'Bayrak',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 93010n,
      barcode: MATCHED_BARCODE,
      stockCode: MATCHED_BARCODE,
      salePrice: new Decimal('472.50'),
      listPrice: new Decimal('472.50'),
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

  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id };
}

function importRequest(ctx: Ctx): Request {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(FIXTURE)]), 'trendyol-plus-tariff.xlsx');
  return new Request(
    `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/plus-commission-tariffs/import`,
    { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
  );
}

describe('POST .../plus-commission-tariffs/import - real Trendyol fixture', () => {
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
    expect(imported.productCount).toBeGreaterThan(40);
    expect(imported.itemCount).toBe(imported.productCount);
    expect(imported.matched).toBe(1);
    expect(imported.unmatched).toBe(imported.productCount - 1);
    expect(imported.skippedRows).toBe(0);

    // A tariff + one item per product row were persisted.
    const tariff = await prisma.plusCommissionTariff.findUnique({
      where: { id: imported.tariffId },
      select: { id: true, storeId: true },
    });
    expect(tariff?.storeId).toBe(ctx.storeId);
    const itemCount = await prisma.plusCommissionTariffItem.count({
      where: { tariffId: imported.tariffId },
    });
    expect(itemCount).toBe(imported.itemCount);
  });

  it('computes profit for the matched product and NO_PRODUCT for the rest', async () => {
    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/plus-commission-tariffs/${imported.tariffId}`,
      { headers: { Authorization: bearer(ctx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire;

    // The single folded 7-day period label surfaces on the tariff.
    expect(body.dateRangeLabel.length).toBeGreaterThan(0);

    const matched = body.items.find((i) => i.barcode === MATCHED_BARCODE);
    expect(matched?.calculable).toBe(true);
    expect(matched?.reason).toBeNull();
    expect(matched?.current.netProfit).not.toBeNull();
    expect(matched?.plus.netProfit).not.toBeNull();
    // The Plus offer's reduced commission was stored verbatim from the sheet.
    expect(Number(matched?.plus.commissionPct)).toBeGreaterThan(0);

    const unmatched = body.items.find((i) => i.barcode !== MATCHED_BARCODE);
    expect(unmatched?.calculable).toBe(false);
    expect(unmatched?.reason).toBe('NO_PRODUCT');
  });
});
