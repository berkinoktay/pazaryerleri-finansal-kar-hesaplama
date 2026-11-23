import { randomUUID } from 'node:crypto';

import { prisma } from '@pazarsync/db';

import { COST_FIXTURE_EPOCH, createOrder } from './factories';
import { ensureFeeDefinitions } from './seed-fee-definitions';

/**
 * Seeds a calculable Trendyol order: a digital variant (so no shipping/PSF line can
 * block the estimate) with a COGS cost profile and a per-line commission rate, so the
 * engine computes a non-null net profit. The cost's version and link date from
 * COST_FIXTURE_EPOCH, so the cost is in force at any order date (plan PR-3b). No
 * statement or line rows are written here --
 * the caller either runs the writer (recomputeParcelProfit) or lets a read path compute
 * the profit read-only in the request. Shared by the order-detail and the live-
 * performance notification tests so the seed lives in exactly one place. Returns the
 * order id.
 */
export async function seedCalculableTrendyolOrder(orgId: string, storeId: string): Promise<string> {
  await ensureFeeDefinitions();

  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1e9)),
      productMainId: `pm-${randomUUID().slice(0, 8)}`,
      title: 'Hesaplanabilir Urun',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: orgId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1e12)),
      barcode: `BC-${randomUUID().slice(0, 10)}`,
      stockCode: `SC-${randomUUID().slice(0, 8)}`,
      salePrice: '240.00',
      listPrice: '240.00',
      isDigital: true,
    },
  });
  const profile = await prisma.costProfile.create({
    data: {
      organizationId: orgId,
      storeId,
      name: `COGS-${randomUUID().slice(0, 8)}`,
      type: 'COGS',
      amountGross: '60.00',
      vatRate: '20',
    },
  });
  await prisma.costProfileVersion.create({
    data: {
      profileId: profile.id,
      organizationId: orgId,
      version: 1,
      name: profile.name,
      type: 'COGS',
      amountGross: '60.00',
      vatRate: '20',
      changedFields: [],
      changedAt: new Date('2024-01-01T00:00:00Z'),
      effectiveFrom: COST_FIXTURE_EPOCH,
    },
  });
  await prisma.productVariantCostProfile.create({
    data: {
      organizationId: orgId,
      productVariantId: variant.id,
      profileId: profile.id,
      attachedAt: COST_FIXTURE_EPOCH,
    },
  });

  const order = await createOrder(orgId, storeId, { status: 'DELIVERED' });
  await prisma.order.update({
    where: { id: order.id },
    data: {
      saleGross: '240.00',
      saleVat: '40.00',
      listGross: '240.00',
      sellerDiscountGross: '0.00',
    },
  });
  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      organizationId: orgId,
      productVariantId: variant.id,
      quantity: 1,
      barcode: variant.barcode,
      lineListGross: '240.00',
      lineSaleGross: '240.00',
      lineSellerDiscountGross: '0.00',
      saleVatRate: '20.00',
      orderCommissionRatePct: '19.00',
    },
  });
  return order.id;
}
