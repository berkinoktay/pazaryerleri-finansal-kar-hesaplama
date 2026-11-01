/**
 * Multi-tenancy isolation for the profit-input triggers (Phase 3B, Task 8).
 *
 * Every input change (cost, settings, shipping, desi, tariff, catalog) enqueues
 * a profit recompute for the AFFECTED orders only. The enqueue helpers select
 * orders through an organization (and, where given, store) filter, so a change
 * in one tenant can never pull another tenant's order — or a sibling store's
 * order — into the queue, even when a barcode is shared. These two tests pin
 * that boundary for the two broadest fan-outs: a cost change (by variant) and a
 * shipping-config change (by store).
 */

import { readFileSync } from 'node:fs';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { ProfitRecomputeReason } from '@pazarsync/db/enums';

import { importTariff } from '@/services/commission-tariff-import.service';
import { deleteTariff } from '@/services/commission-tariff.service';
import { updateCostProfile } from '@/services/cost-profile.service';
import { updateShippingConfig } from '@/services/shipping-config.service';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createOrder,
  createOrderItem,
  createOrganization,
  createProduct,
  createProductVariant,
  createStore,
  createUserProfile,
} from '../../helpers/factories';

// The real Trendyol "Urun Komisyon Tarifeleri" export; one of its product rows
// carries the barcode below. Imported/deleted through the service to prove the
// recompute enqueue stays scoped to the acting organization and store.
const TARIFF_FIXTURE = readFileSync(
  new URL('../../fixtures/trendyol-commission-tariff.xlsx', import.meta.url),
);
const FIXTURE_BARCODE = 'TB200X300A';

/** Creates an order in the given store carrying one item with the fixture's barcode. */
async function orderCarryingFixtureBarcode(orgId: string, storeId: string): Promise<string> {
  const order = await createOrder(orgId, storeId);
  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      organizationId: orgId,
      quantity: 1,
      lineSaleGross: '0.00',
      commissionRate: '0.00',
      commissionGross: '0.00',
      barcode: FIXTURE_BARCODE,
    },
  });
  return order.id;
}

describe('Tenant isolation — profit recompute triggers', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('never queues another organization order on a cost change', async () => {
    const user = await createUserProfile();

    // Org A: a profile attached to variant A, an order carrying variant A.
    const orgA = await createOrganization();
    const storeA = await createStore(orgA.id);
    const profileA = await prisma.costProfile.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        name: 'Org A COGS',
        type: 'COGS',
        amountGross: new Decimal('25.00'),
        currency: 'TRY',
        vatRate: 0,
        fxRateMode: 'AUTO',
      },
    });
    const productA = await createProduct(orgA.id, storeA.id);
    const variantA = await createProductVariant(orgA.id, storeA.id, productA.id, {
      barcode: 'SHARED-BARCODE',
    });
    await prisma.productVariantCostProfile.create({
      data: { organizationId: orgA.id, profileId: profileA.id, productVariantId: variantA.id },
    });
    const orderA = await createOrder(orgA.id, storeA.id);
    await createOrderItem(orderA.id, orgA.id, { productVariantId: variantA.id });

    // Org B: its OWN variant with the SAME barcode, and its own order.
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const productB = await createProduct(orgB.id, storeB.id);
    const variantB = await createProductVariant(orgB.id, storeB.id, productB.id, {
      barcode: 'SHARED-BARCODE',
    });
    const orderB = await createOrder(orgB.id, storeB.id);
    await createOrderItem(orderB.id, orgB.id, { productVariantId: variantB.id });

    await updateCostProfile(orgA.id, profileA.id, { amountGross: '99.00' }, user.id);

    const queuedA = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: orderA.id },
    });
    expect(queuedA?.reason).toBe(ProfitRecomputeReason.COST_CHANGED);

    const queuedB = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: orderB.id },
    });
    expect(queuedB).toBeNull();
  });

  it('never queues a sibling store order on a shipping config change', async () => {
    const org = await createOrganization();
    const storeA = await createStore(org.id);
    const storeB = await createStore(org.id);

    const orderA = await createOrder(org.id, storeA.id);
    const siblingOrder = await createOrder(org.id, storeB.id);

    await prisma.$transaction((tx) =>
      updateShippingConfig(
        org.id,
        storeA.id,
        { shippingTariffSource: 'OWN_CONTRACT', defaultShippingCarrierId: null },
        tx,
      ),
    );

    const queuedA = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: orderA.id },
    });
    expect(queuedA?.reason).toBe(ProfitRecomputeReason.REFERENCE_CHANGED);

    const queuedSibling = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: siblingOrder.id },
    });
    expect(queuedSibling).toBeNull();
  });

  it('never queues another organization or a sibling store order on a commission tariff import', async () => {
    // Org A with two stores, org B with one; each store has an order carrying the
    // fixture's barcode. The import runs for store A1 only.
    const orgA = await createOrganization();
    const storeA1 = await createStore(orgA.id);
    const storeA2 = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const orderA1 = await orderCarryingFixtureBarcode(orgA.id, storeA1.id);
    const orderA2 = await orderCarryingFixtureBarcode(orgA.id, storeA2.id);
    const orderB = await orderCarryingFixtureBarcode(orgB.id, storeB.id);

    await importTariff({
      organizationId: orgA.id,
      storeId: storeA1.id,
      file: TARIFF_FIXTURE,
      filename: 'trendyol-commission-tariff.xlsx',
      createdBy: null,
      now: new Date('2026-06-24T00:00:00Z'),
    });

    const queuedA1 = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: orderA1 },
    });
    expect(queuedA1?.reason).toBe(ProfitRecomputeReason.REFERENCE_CHANGED);

    expect(
      await prisma.profitRecomputeRequest.findUnique({ where: { orderId: orderA2 } }),
    ).toBeNull();
    expect(
      await prisma.profitRecomputeRequest.findUnique({ where: { orderId: orderB } }),
    ).toBeNull();
  });

  it('never queues another organization or a sibling store order on a commission tariff delete', async () => {
    const orgA = await createOrganization();
    const storeA1 = await createStore(orgA.id);
    const storeA2 = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const orderA1 = await orderCarryingFixtureBarcode(orgA.id, storeA1.id);
    const orderA2 = await orderCarryingFixtureBarcode(orgA.id, storeA2.id);
    const orderB = await orderCarryingFixtureBarcode(orgB.id, storeB.id);

    const imported = await importTariff({
      organizationId: orgA.id,
      storeId: storeA1.id,
      file: TARIFF_FIXTURE,
      filename: 'trendyol-commission-tariff.xlsx',
      createdBy: null,
      now: new Date('2026-06-24T00:00:00Z'),
    });

    // The import itself enqueues A1's order; clear the queue so the assertion proves
    // the delete's own enqueue, not the import's.
    await prisma.profitRecomputeRequest.deleteMany();

    await deleteTariff(orgA.id, storeA1.id, imported.tariffId);

    const queuedA1 = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: orderA1 },
    });
    expect(queuedA1?.reason).toBe(ProfitRecomputeReason.REFERENCE_CHANGED);

    expect(
      await prisma.profitRecomputeRequest.findUnique({ where: { orderId: orderA2 } }),
    ).toBeNull();
    expect(
      await prisma.profitRecomputeRequest.findUnique({ where: { orderId: orderB } }),
    ).toBeNull();
  });
});
