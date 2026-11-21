/**
 * Multi-tenancy isolation for the profit-input triggers (Phase 3B, Task 8).
 *
 * A cost or settings change enqueues a profit recompute for the AFFECTED orders
 * only. The enqueue helpers select orders through an organization (and, where
 * given, store) filter, so a change in one tenant can never pull another tenant's
 * order into the queue, even when a barcode is shared. One test pins that boundary
 * for the broadest fan-out: a cost change (by variant).
 *
 * A shipping-config change is no longer an order trigger: a stored order keeps the
 * tariff source captured at intake, so the change queues no order of any store.
 *
 * A commission tariff is not an order input: an order's commission never reads a
 * tariff's bands, so its import and delete queue no order at all, not even one of
 * the acting store.
 */

import { readFileSync } from 'node:fs';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { ProfitRecomputeReason } from '@pazarsync/db/enums';

import { NotFoundError } from '@/lib/errors';
import { importTariff } from '@/workbooks/verticals/commission-tariff.adapter';
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
// carries the barcode below. Imported and deleted through the service to prove that
// neither queues an order, and that a delete stays inside its organization and store.
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
        vatRate: 0,
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

  it('queues no order of any store on a shipping config change', async () => {
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
    expect(queuedA).toBeNull();

    const queuedSibling = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: siblingOrder.id },
    });
    expect(queuedSibling).toBeNull();
  });

  it('queues no order on a commission tariff import or delete, not even one of the acting store', async () => {
    // Org A with two stores, org B with one; each store has an order carrying the
    // fixture's barcode. The import and the delete run for store A1.
    const orgA = await createOrganization();
    const storeA1 = await createStore(orgA.id);
    const storeA2 = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const orderIds = [
      await orderCarryingFixtureBarcode(orgA.id, storeA1.id),
      await orderCarryingFixtureBarcode(orgA.id, storeA2.id),
      await orderCarryingFixtureBarcode(orgB.id, storeB.id),
    ];
    const queuedOrderIds = async (): Promise<string[]> =>
      (
        await prisma.profitRecomputeRequest.findMany({
          where: { orderId: { in: orderIds } },
          select: { orderId: true },
        })
      ).map((row) => row.orderId);

    const imported = await importTariff({
      organizationId: orgA.id,
      storeId: storeA1.id,
      file: TARIFF_FIXTURE,
      filename: 'trendyol-commission-tariff.xlsx',
      createdBy: null,
      now: new Date('2026-06-24T00:00:00Z'),
    });
    expect(await queuedOrderIds()).toEqual([]);

    await deleteTariff(orgA.id, storeA1.id, imported.tariffId);
    expect(await queuedOrderIds()).toEqual([]);
    expect(await prisma.commissionTariff.count({ where: { id: imported.tariffId } })).toBe(0);
  });

  it('refuses to delete a tariff of another organization or of a sibling store, as a missing one', async () => {
    const orgA = await createOrganization();
    const storeA1 = await createStore(orgA.id);
    const storeA2 = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const imported = await importTariff({
      organizationId: orgA.id,
      storeId: storeA1.id,
      file: TARIFF_FIXTURE,
      filename: 'trendyol-commission-tariff.xlsx',
      createdBy: null,
      now: new Date('2026-06-24T00:00:00Z'),
    });

    await expect(deleteTariff(orgB.id, storeB.id, imported.tariffId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(deleteTariff(orgA.id, storeA2.id, imported.tariffId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await prisma.commissionTariff.count({ where: { id: imported.tariffId } })).toBe(1);
  });
});
