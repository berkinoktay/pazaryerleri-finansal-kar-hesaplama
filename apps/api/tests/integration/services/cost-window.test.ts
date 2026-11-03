import { prisma } from '@pazarsync/db';
import { hadCostWithinOrderDay } from '@pazarsync/order-sync';
import { getBusinessDayRange } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createCostProfile, createOrganization, createStore } from '../../helpers/factories';

// The cost-window helper (Berkin 2026-11-03): true iff every non-cancelled item
// had a cost entered before the order's business day ended. The day end is the
// exclusive upper bound of the order's business day, so a cost attached one minute
// earlier counts and one minute later does not. See packages/order-sync/src/cost-window.ts.

// A past business day, far enough back that the test never straddles midnight.
const ORDER_DATE = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
const DAY_END = getBusinessDayRange(ORDER_DATE).end;
const ONE_MINUTE_MS = 60 * 1000;

async function createVariant(orgId: string, storeId: string, barcode: string): Promise<string> {
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${barcode}`,
      title: 'Cost Window Product',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: orgId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode,
      stockCode: `sk-${barcode}`,
      salePrice: '100',
      listPrice: '120',
    },
  });
  return variant.id;
}

// Attach a cost profile to a variant with an explicit link `attachedAt` and an
// explicit first-version `effectiveFrom`, so each test can position both timestamps
// relative to the order's day end.
async function attachCost(params: {
  orgId: string;
  storeId: string;
  variantId: string;
  attachedAt: Date;
  versionEffectiveFrom: Date;
}): Promise<void> {
  const profile = await createCostProfile(params.orgId, {
    storeId: params.storeId,
    amountGross: '40.00',
  });
  await prisma.productVariantCostProfile.create({
    data: {
      organizationId: params.orgId,
      productVariantId: params.variantId,
      profileId: profile.id,
      attachedAt: params.attachedAt,
    },
  });
  await prisma.costProfileVersion.create({
    data: {
      profileId: profile.id,
      organizationId: params.orgId,
      version: 1,
      name: profile.name,
      type: profile.type,
      amountGross: profile.amountGross,
      vatRate: profile.vatRate,
      changedFields: [],
      effectiveFrom: params.versionEffectiveFrom,
    },
  });
}

describe('hadCostWithinOrderDay', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('counts a cost attached before the end of the order day', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variantId = await createVariant(org.id, store.id, 'EAN13-CW-OK');
    await attachCost({
      orgId: org.id,
      storeId: store.id,
      variantId,
      attachedAt: new Date(DAY_END.getTime() - ONE_MINUTE_MS),
      versionEffectiveFrom: new Date(DAY_END.getTime() - ONE_MINUTE_MS),
    });

    const result = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: variantId, isCancelled: false }],
    });
    expect(result).toBe(true);
  });

  it('ignores a cost attached after the end of the order day', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variantId = await createVariant(org.id, store.id, 'EAN13-CW-LATE');
    await attachCost({
      orgId: org.id,
      storeId: store.id,
      variantId,
      attachedAt: new Date(DAY_END.getTime() + ONE_MINUTE_MS),
      versionEffectiveFrom: new Date(DAY_END.getTime() + ONE_MINUTE_MS),
    });

    const result = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: variantId, isCancelled: false }],
    });
    expect(result).toBe(false);
  });

  it('ignores a profile whose first version starts after the order day', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variantId = await createVariant(org.id, store.id, 'EAN13-CW-VER');
    // The link itself is attached in time, but the profile's only version becomes
    // effective after the order day -- so no priced version was in force in time.
    await attachCost({
      orgId: org.id,
      storeId: store.id,
      variantId,
      attachedAt: new Date(DAY_END.getTime() - ONE_MINUTE_MS),
      versionEffectiveFrom: new Date(DAY_END.getTime() + ONE_MINUTE_MS),
    });

    const result = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: variantId, isCancelled: false }],
    });
    expect(result).toBe(false);
  });

  it('treats an unresolved variant as missing a cost', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    const result = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: null, isCancelled: false }],
    });
    expect(result).toBe(false);
  });

  it('skips cancelled items', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    // The order's only item is cancelled and carries no cost; a cancelled line
    // needs no cost, so with nothing left to check the window is satisfied.
    const result = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: null, isCancelled: true }],
    });
    expect(result).toBe(true);
  });
});
