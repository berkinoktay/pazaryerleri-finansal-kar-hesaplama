/**
 * Order.estimated_net_profit REFINABILITY (2026-06-13).
 *
 * PR-9'daki write-once trigger (`orders_estimated_net_profit_write_once`)
 * KALDIRILDI. Gerekçe (design 2026-06-13 §5): kargo bedeli fatura çıkana kadar
 * bir TAHMİNDİR ve daha iyi bilgi geldikçe rafine olur (T+0 ürün-desi →
 * kargoya verilince cargoDeci). Bu yüzden "tahmini kâr" güncellenebilir olmalı.
 *
 * KORUNAN garantiler (burada DEĞİL, ilgili dosyalarda test edilir):
 *   - Maliyet snapshot immutability → cost-snapshot-immutability.test.ts
 *   - EXCLUDED sipariş kâr donması → services/profit-freeze-guards.test.ts
 */

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, prisma, truncateAll } from '../helpers/db';
import { createOrder, createOrganization, createStore } from '../helpers/factories';

async function buildOrder(estimatedNetProfit: Decimal | null) {
  const org = await createOrganization();
  const store = await createStore(org.id);
  const order = await createOrder(org.id, store.id);

  if (estimatedNetProfit !== null) {
    await prisma.order.update({
      where: { id: order.id },
      data: { estimatedNetProfit },
    });
  }
  return { orderId: order.id };
}

describe('Order.estimated_net_profit is refinable (write-once relaxed for cargo)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('allows first write: null → 100', async () => {
    const { orderId } = await buildOrder(null);

    await expect(
      prisma.order.update({
        where: { id: orderId },
        data: { estimatedNetProfit: new Decimal('100.00') },
      }),
    ).resolves.toBeDefined();
  });

  it('allows refinement: 100 → 150 (cargo estimate sharpened by cargoDeci)', async () => {
    const { orderId } = await buildOrder(new Decimal('100.00'));

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { estimatedNetProfit: new Decimal('150.00') },
    });
    expect(new Decimal(updated.estimatedNetProfit!).toString()).toBe('150');
  });

  it('allows refinement down: 100 → 0', async () => {
    const { orderId } = await buildOrder(new Decimal('100.00'));

    await expect(
      prisma.order.update({
        where: { id: orderId },
        data: { estimatedNetProfit: new Decimal('0.00') },
      }),
    ).resolves.toBeDefined();
  });

  it('allows clearing back to null', async () => {
    const { orderId } = await buildOrder(new Decimal('100.00'));

    await expect(
      prisma.order.update({
        where: { id: orderId },
        data: { estimatedNetProfit: null },
      }),
    ).resolves.toBeDefined();
  });

  it('allows UPDATE that does not touch estimated_net_profit', async () => {
    const { orderId } = await buildOrder(new Decimal('100.00'));

    await expect(
      prisma.order.update({
        where: { id: orderId },
        data: { status: 'DELIVERED' },
      }),
    ).resolves.toBeDefined();
  });
});
