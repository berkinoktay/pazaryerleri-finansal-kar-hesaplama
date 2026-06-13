import { estimateShippingCostForOrder } from '@pazarsync/profit';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { ensureDbReachable, truncateAll } from '../helpers/db';

// ─── Fixture ───────────────────────────────────────────────────────────────
// org → store(SENDEOMP, TRENDYOL_CONTRACT) → product → variants → order + items.
// Order estimator: desi = cargoDeci ?? adet-ağırlıklı ortalama(ürün desisi),
// Barem aralığı = saleSubtotalNet + saleVatTotal (indirimli brüt).

async function getSendeomp() {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  if (!carrier) throw new Error('SENDEOMP carrier missing — shipping seed must run first');
  return carrier;
}

interface OrderFixtureOptions {
  items: { desi: string; qty: number }[];
  grossSubtotalNet: string;
  grossVatTotal: string;
  cargoDeci: string | null;
  fastDelivery: boolean;
  withCarrier?: boolean; // default true
  tariffSource?: 'TRENDYOL_CONTRACT' | 'OWN_CONTRACT';
}

async function createOrderFixture(opts: OrderFixtureOptions): Promise<{ orderId: string }> {
  const stamp = `${randomUUID().slice(0, 8)}`;
  const carrier = await getSendeomp();
  const org = await prisma.organization.create({
    data: { name: `Org ${stamp}`, slug: `org-${stamp}` },
  });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: `Store ${stamp}`,
      platform: 'TRENDYOL',
      externalAccountId: `acct-${stamp}`,
      credentials: 'enc-blob',
      shippingTariffSource: opts.tariffSource ?? 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: (opts.withCarrier ?? true) ? carrier.id : null,
    },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId:
        BigInt(`${Date.now()}`.slice(-9)) + BigInt(Math.floor(Math.random() * 1000)),
      productMainId: `pm-${stamp}`,
      title: 'Test',
    },
  });
  const order = await prisma.order.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformOrderId: `po-${stamp}`,
      orderDate: new Date('2026-06-13T08:00:00Z'),
      status: 'PROCESSING',
      saleSubtotalNet: opts.grossSubtotalNet,
      saleVatTotal: opts.grossVatTotal,
      cargoDeci: opts.cargoDeci,
      fastDelivery: opts.fastDelivery,
    },
  });
  let seq = 0;
  for (const it of opts.items) {
    seq += 1;
    const variant = await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: BigInt(`${Date.now()}`.slice(-8)) + BigInt(seq * 7),
        barcode: `bc-${stamp}-${seq}`,
        stockCode: `sk-${stamp}-${seq}`,
        salePrice: '100.00',
        listPrice: '100.00',
        syncedDimensionalWeight: it.desi,
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        organizationId: org.id,
        productVariantId: variant.id,
        barcode: variant.barcode,
        quantity: it.qty,
        unitPrice: '100.00',
        commissionRate: '0',
        commissionAmount: '0',
      },
    });
  }
  return { orderId: order.id };
}

describe('estimateShippingCostForOrder', () => {
  beforeAll(ensureDbReachable);
  beforeEach(truncateAll);

  it('uses quantity-weighted average product desi at T+0 (no cargoDeci)', async () => {
    // (2×1 + 1×4) / 3 = 2 → SENDEOMP desi-2 = 91.99
    const { orderId } = await createOrderFixture({
      items: [
        { desi: '1', qty: 2 },
        { desi: '4', qty: 1 },
      ],
      grossSubtotalNet: '500.00',
      grossVatTotal: '0.00',
      cargoDeci: null,
      fastDelivery: false,
    });
    const out = await prisma.$transaction((tx) => estimateShippingCostForOrder(orderId, tx));
    expect(out.ok).toBe(true);
    if (!out.ok) expect.fail('expected ok');
    expect(out.estimate.tariffApplied).toBe('NORMAL');
    expect(out.estimate.carrierCode).toBe('SENDEOMP');
    expect(out.estimate.baseDesiAtEstimate.toString()).toBe('2');
    expect(out.estimate.amount.toString()).toBe('91.99');
  });

  it('prefers cargoDeci over product desi when present', async () => {
    const { orderId } = await createOrderFixture({
      items: [{ desi: '1', qty: 1 }],
      grossSubtotalNet: '500.00',
      grossVatTotal: '0.00',
      cargoDeci: '5',
      fastDelivery: false,
    });
    const out = await prisma.$transaction((tx) => estimateShippingCostForOrder(orderId, tx));
    expect(out.ok).toBe(true);
    if (!out.ok) expect.fail('expected ok');
    expect(out.estimate.baseDesiAtEstimate.toString()).toBe('5');
  });

  it('applies Barem on the discounted gross order total (<350, fast, ≤10 desi)', async () => {
    const { orderId } = await createOrderFixture({
      items: [{ desi: '2', qty: 1 }],
      grossSubtotalNet: '150.00',
      grossVatTotal: '0.00',
      cargoDeci: null,
      fastDelivery: true,
    });
    const out = await prisma.$transaction((tx) => estimateShippingCostForOrder(orderId, tx));
    expect(out.ok).toBe(true);
    if (!out.ok) expect.fail('expected ok');
    expect(out.estimate.tariffApplied).toBe('BAREM');
  });

  it('returns DESI_OVERFLOW when desi exceeds the carrier tariff (≥350 → desi-based)', async () => {
    const { orderId } = await createOrderFixture({
      items: [{ desi: '20', qty: 1 }],
      grossSubtotalNet: '1500.00',
      grossVatTotal: '0.00',
      cargoDeci: null,
      fastDelivery: false,
    });
    const out = await prisma.$transaction((tx) => estimateShippingCostForOrder(orderId, tx));
    expect(out).toEqual({ ok: false, reason: 'DESI_OVERFLOW' });
  });

  it('returns NO_CARRIER when TRENDYOL_CONTRACT store has no default carrier', async () => {
    const { orderId } = await createOrderFixture({
      items: [{ desi: '2', qty: 1 }],
      grossSubtotalNet: '500.00',
      grossVatTotal: '0.00',
      cargoDeci: null,
      fastDelivery: false,
      withCarrier: false,
    });
    const out = await prisma.$transaction((tx) => estimateShippingCostForOrder(orderId, tx));
    expect(out).toEqual({ ok: false, reason: 'NO_CARRIER' });
  });
});
