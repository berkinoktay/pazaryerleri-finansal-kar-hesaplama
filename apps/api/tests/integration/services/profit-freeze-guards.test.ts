/**
 * Profit-freeze DB guards (spec 2026-06-12 cost-deadline-profit-freeze §5).
 *
 * Calculated-or-excluded sözleşmesinin DB bekçileri:
 *   - `reject_profit_freeze_breach` trigger'ı (BEFORE UPDATE on orders):
 *     kâr-dışı siparişe estimate/settled yazımı, damganın silinmesi/değişmesi
 *     ve hesaplanmış siparişin kâr-dışına çekilmesi 42501 ile reddedilir.
 *   - CHECK'ler (INSERT dahil her yolu kapatır — trigger yalnız UPDATE dinler):
 *     orders_profit_freeze_xor_check + orders_profit_exclusion_pair_check.
 *
 * Assert üslubu ev kalıbı (order-immutability.test.ts): mesaj regex'i —
 * reddedenin BİZİM trigger'ımız olduğunu kanıtlar, jenerik 42501 değil.
 */

import { Prisma, prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrder, createOrganization, createStore } from '../../helpers/factories';

describe('profit-freeze DB guards (spec 2026-06-12)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  async function buildExcludedOrder(): Promise<string> {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const order = await createOrder(org.id, store.id);
    await prisma.order.update({
      where: { id: order.id },
      data: { profitExcludedAt: new Date(), profitExclusionReason: 'COST_DEADLINE_MISSED' },
    });
    return order.id;
  }

  it('kâr-dışı siparişe estimate yazılamaz', async () => {
    const orderId = await buildExcludedOrder();
    await expect(
      prisma.order.update({
        where: { id: orderId },
        data: { estimatedNetProfit: new Prisma.Decimal('10.00') },
      }),
    ).rejects.toThrow(/estimated_net_profit is frozen/);
  });

  it('kâr-dışı siparişe settled kâr yazılamaz (karar K1)', async () => {
    const orderId = await buildExcludedOrder();
    await expect(
      prisma.order.update({
        where: { id: orderId },
        data: { settledNetProfit: new Prisma.Decimal('10.00') },
      }),
    ).rejects.toThrow(/settled_net_profit is frozen/);
  });

  it('kâr-dışı damgası silinemez/değiştirilemez', async () => {
    const orderId = await buildExcludedOrder();
    await expect(
      prisma.order.update({
        where: { id: orderId },
        data: { profitExcludedAt: null, profitExclusionReason: null },
      }),
    ).rejects.toThrow(/profit exclusion is permanent/);
  });

  it('estimate yazılmış sipariş kâr-dışına çekilemez', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const order = await createOrder(org.id, store.id);
    await prisma.order.update({
      where: { id: order.id },
      data: { estimatedNetProfit: new Prisma.Decimal('42.00') },
    });
    await expect(
      prisma.order.update({
        where: { id: order.id },
        data: { profitExcludedAt: new Date(), profitExclusionReason: 'LEGACY_BACKFILL' },
      }),
    ).rejects.toThrow(/calculated order cannot be excluded/);
  });

  it('CHECK: hesaplanmış + kâr-dışı aynı anda imkânsız (raw bypass dahil)', async () => {
    const orderId = await buildExcludedOrder();
    await expect(
      prisma.$executeRaw`UPDATE orders SET estimated_net_profit = 10, profit_excluded_at = profit_excluded_at WHERE id = ${orderId}::uuid`,
    ).rejects.toThrow();
  });

  it('CHECK: INSERT yolu da kapalı — trigger UPDATE dinler, INSERT işi CHECK için', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // Hem hesaplanmış hem kâr-dışı doğan satır → orders_profit_freeze_xor_check.
    await expect(
      prisma.order.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          platformOrderId: 'xor-insert-1',
          orderDate: new Date(),
          status: 'PROCESSING',
          estimatedNetProfit: new Prisma.Decimal('10.00'),
          profitExcludedAt: new Date(),
          profitExclusionReason: 'LEGACY_BACKFILL',
        },
      }),
    ).rejects.toThrow(/orders_profit_freeze_xor_check/);
  });

  it('CHECK: damga ve gerekçe birlikte yaşar (pair check)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // Damga var, gerekçe yok → orders_profit_exclusion_pair_check.
    await expect(
      prisma.order.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          platformOrderId: 'pair-insert-1',
          orderDate: new Date(),
          status: 'PROCESSING',
          profitExcludedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/orders_profit_exclusion_pair_check/);
  });

  it('status/kargo güncellemeleri kâr-dışı siparişte SERBEST kalır', async () => {
    const orderId = await buildExcludedOrder();
    await prisma.order.update({ where: { id: orderId }, data: { status: 'DELIVERED' } });
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(updated.status).toBe('DELIVERED');
    expect(updated.profitExcludedAt).not.toBeNull();
  });
});
