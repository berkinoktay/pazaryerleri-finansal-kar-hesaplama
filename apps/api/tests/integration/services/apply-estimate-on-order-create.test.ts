import { Decimal } from 'decimal.js';
import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyEstimateOnOrderCreate } from '@pazarsync/profit';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrder, createOrganization, createStore } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

/**
 * Integration tests for `applyEstimateOnOrderCreate` (design §4.2).
 *
 * **PR-6 / Option D context:** Sync handler caller henüz yok (Trendyol Order
 * Sync ayrı epic). Bu test'ler service'i mock data ile direkt çağırır.
 *
 * Test scenarios:
 *   1. Happy path — PSF + Stopaj OrderFee yazılır, estimatedNetProfit hesaplanır
 *   2. RETURNED status — PSF muafiyet, OrderFee yazılmaz
 *   3. micro=true — PSF muafiyet
 *   4. Cost snapshot eksik — estimatedNetProfit null kalır
 *   5. Write-once — re-entry no-op
 *   6. saleSubtotalNet null — early return
 */
describe('applyEstimateOnOrderCreate (PR-6)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions(); // 4 Trendyol satırı PR-2 seed
  });

  async function setup() {
    const org = await createOrganization();
    const store = await createStore(org.id, { platform: 'TRENDYOL' });
    return { org, store };
  }

  async function createOrderWithItem(args: {
    orgId: string;
    storeId: string;
    saleSubtotalNet?: string;
    saleVatTotal?: string;
    status?: 'DELIVERED' | 'RETURNED';
    micro?: boolean;
    unitCostSnapshotNet?: string | null;
    unitCostSnapshotVatAmount?: string | null;
    isDigital?: boolean;
    fastDeliveryType?: string | null;
    actualShipDate?: Date | null;
    orderDate?: Date;
  }) {
    const order = await prisma.order.update({
      where: {
        id: (
          await createOrder(args.orgId, args.storeId, {
            status: args.status ?? 'DELIVERED',
          })
        ).id,
      },
      data: {
        saleSubtotalNet: args.saleSubtotalNet ?? '100.00',
        saleVatTotal: args.saleVatTotal ?? '20.00',
        micro: args.micro ?? false,
        ...(args.fastDeliveryType !== undefined && { fastDeliveryType: args.fastDeliveryType }),
        ...(args.actualShipDate !== undefined && { actualShipDate: args.actualShipDate }),
        ...(args.orderDate !== undefined && { orderDate: args.orderDate }),
      },
    });

    // Minimal product + variant + OrderItem
    const product = await prisma.product.create({
      data: {
        organizationId: args.orgId,
        storeId: args.storeId,
        platformContentId: BigInt(Date.now() + Math.floor(Math.random() * 100000)),
        productMainId: `pm-${order.id.slice(0, 8)}`,
        title: 'Test Product',
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        organizationId: args.orgId,
        storeId: args.storeId,
        productId: product.id,
        platformVariantId: BigInt(Date.now() + Math.floor(Math.random() * 100000)),
        barcode: `bc-${order.id.slice(0, 6)}`,
        stockCode: `sk-${order.id.slice(0, 6)}`,
        salePrice: '100',
        listPrice: '120',
        isDigital: args.isDigital ?? false,
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        organizationId: args.orgId,
        productVariantId: variant.id,
        quantity: 1,
        unitPrice: '120', // eski KDV-dahil
        commissionRate: '10',
        commissionAmount: '12', // eski KDV-dahil
        // Yeni convention:
        grossCommissionAmountNet: '10',
        grossCommissionVatAmount: '2',
        unitCostSnapshotNet:
          args.unitCostSnapshotNet !== undefined ? args.unitCostSnapshotNet : '50',
        unitCostSnapshotVatAmount:
          args.unitCostSnapshotVatAmount !== undefined ? args.unitCostSnapshotVatAmount : '10',
      },
    });

    return order;
  }

  it('carrier configured → SHIPPING ESTIMATE fee yazılır ve estimatedNetProfit kargoyu içerir', async () => {
    // design 2026-06-13 §3: order-level kargo tahmini (desi 0 → en alt tarife).
    const org = await createOrganization();
    const carrier = await prisma.shippingCarrier.findFirstOrThrow({ where: { code: 'SENDEOMP' } });
    const store = await createStore(org.id, { platform: 'TRENDYOL' });
    await prisma.store.update({
      where: { id: store.id },
      data: { defaultShippingCarrierId: carrier.id },
    });
    const order = await createOrderWithItem({ orgId: org.id, storeId: store.id });

    await prisma.$transaction((tx) => applyEstimateOnOrderCreate(order.id, tx));

    const shippingFee = await prisma.orderFee.findFirst({
      where: { orderId: order.id, feeType: 'SHIPPING', source: 'ESTIMATE' },
    });
    expect(shippingFee).not.toBeNull();
    expect(shippingFee?.direction).toBe('DEBIT');
    expect(new Decimal(shippingFee!.amountNet).gt(0)).toBe(true);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.estimatedNetProfit).not.toBeNull();
  });

  it('cargoDeci dolunca re-entry SHIPPING fee satirini gunceller (write-once gevsedi)', async () => {
    const org = await createOrganization();
    const carrier = await prisma.shippingCarrier.findFirstOrThrow({ where: { code: 'SENDEOMP' } });
    const store = await createStore(org.id, { platform: 'TRENDYOL' });
    await prisma.store.update({
      where: { id: store.id },
      data: { defaultShippingCarrierId: carrier.id },
    });
    const order = await createOrderWithItem({ orgId: org.id, storeId: store.id });

    // T+0: cargoDeci yok → desi-0 tahmini.
    await prisma.$transaction((tx) => applyEstimateOnOrderCreate(order.id, tx));
    const feeT0 = await prisma.orderFee.findFirstOrThrow({
      where: { orderId: order.id, feeType: 'SHIPPING', source: 'ESTIMATE' },
    });
    const estimatedT0 = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } }))
      .estimatedNetProfit;

    // Kargoya verildi: cargoDeci = 8 → re-entry tahmini günceller (write-once yok).
    await prisma.order.update({ where: { id: order.id }, data: { cargoDeci: '8' } });
    await prisma.$transaction((tx) => applyEstimateOnOrderCreate(order.id, tx));

    const fees = await prisma.orderFee.findMany({
      where: { orderId: order.id, feeType: 'SHIPPING', source: 'ESTIMATE' },
    });
    expect(fees).toHaveLength(1); // UPSERT — yeni satır YOK
    expect(fees[0]?.id).toBe(feeT0.id);
    const estimatedAfter = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } }))
      .estimatedNetProfit;
    // desi 8 > 0 → daha pahalı kargo → tahmini kâr düştü (rafine oldu).
    expect(new Decimal(estimatedAfter!).lt(estimatedT0!)).toBe(true);
  });

  it('happy path — PSF + Stopaj OrderFee yazılır, estimatedNetProfit hesaplanır', async () => {
    const { org, store } = await setup();
    const order = await createOrderWithItem({
      orgId: org.id,
      storeId: store.id,
      saleSubtotalNet: '100.00',
      saleVatTotal: '20.00',
    });

    await prisma.$transaction(async (tx) => {
      await applyEstimateOnOrderCreate(order.id, tx);
    });

    const fees = await prisma.orderFee.findMany({
      where: { orderId: order.id },
      orderBy: { feeType: 'asc' },
    });
    expect(fees.map((f) => f.feeType).sort()).toEqual(['PLATFORM_SERVICE', 'STOPPAGE']);

    const psf = fees.find((f) => f.feeType === 'PLATFORM_SERVICE')!;
    expect(new Decimal(psf.amountNet).toString()).toBe('10.99');
    expect(new Decimal(psf.vatAmount).toString()).toBe('2.2');
    expect(psf.source).toBe('ESTIMATE');
    expect(psf.direction).toBe('DEBIT');

    const stopaj = fees.find((f) => f.feeType === 'STOPPAGE')!;
    expect(new Decimal(stopaj.amountNet).toString()).toBe('1'); // 100 × 0.01
    expect(new Decimal(stopaj.vatAmount).toString()).toBe('0');

    // Profit = saleSubtotalNet − itemCost − commission − PSF − Stopaj
    //       = 100 − 50 − 10 − 10.99 − 1 = 28.01
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(new Decimal(updated.estimatedNetProfit!).toString()).toBe('28.01');
  });

  it('PSF muafiyet — status RETURNED → PSF OrderFee yazılmaz', async () => {
    const { org, store } = await setup();
    const order = await createOrderWithItem({
      orgId: org.id,
      storeId: store.id,
      status: 'RETURNED',
    });

    await prisma.$transaction(async (tx) => {
      await applyEstimateOnOrderCreate(order.id, tx);
    });

    const fees = await prisma.orderFee.findMany({ where: { orderId: order.id } });
    expect(fees.map((f) => f.feeType).sort()).toEqual(['STOPPAGE']);
    expect(fees.some((f) => f.feeType === 'PLATFORM_SERVICE')).toBe(false);
  });

  it('PSF muafiyet — micro=true → PSF OrderFee yazılmaz', async () => {
    const { org, store } = await setup();
    const order = await createOrderWithItem({
      orgId: org.id,
      storeId: store.id,
      micro: true,
    });

    await prisma.$transaction(async (tx) => {
      await applyEstimateOnOrderCreate(order.id, tx);
    });

    const fees = await prisma.orderFee.findMany({ where: { orderId: order.id } });
    expect(fees.some((f) => f.feeType === 'PLATFORM_SERVICE')).toBe(false);
  });

  it('PSF muafiyet — all-digital → PSF OrderFee yazılmaz', async () => {
    const { org, store } = await setup();
    const order = await createOrderWithItem({
      orgId: org.id,
      storeId: store.id,
      isDigital: true,
    });

    await prisma.$transaction(async (tx) => {
      await applyEstimateOnOrderCreate(order.id, tx);
    });

    const fees = await prisma.orderFee.findMany({ where: { orderId: order.id } });
    expect(fees.some((f) => f.feeType === 'PLATFORM_SERVICE')).toBe(false);
  });

  it('Cost snapshot eksik → estimatedNetProfit null kalır', async () => {
    const { org, store } = await setup();
    const order = await createOrderWithItem({
      orgId: org.id,
      storeId: store.id,
      unitCostSnapshotNet: null,
      unitCostSnapshotVatAmount: null,
    });

    await prisma.$transaction(async (tx) => {
      await applyEstimateOnOrderCreate(order.id, tx);
    });

    // Fee'ler yazılır (PSF + Stopaj) ama estimatedNetProfit null kalır
    const fees = await prisma.orderFee.findMany({ where: { orderId: order.id } });
    expect(fees.length).toBeGreaterThanOrEqual(2);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.estimatedNetProfit).toBeNull();
  });

  it('Null-estimate re-entry — fee duplike edilmez, snapshot dolunca estimate tamamlanır', async () => {
    const { org, store } = await setup();
    const order = await createOrderWithItem({
      orgId: org.id,
      storeId: store.id,
      unitCostSnapshotNet: null,
      unitCostSnapshotVatAmount: null,
    });

    // T+0: cost_missing — PSF + Stopaj yazılır, estimate null kalır.
    await prisma.$transaction(async (tx) => {
      await applyEstimateOnOrderCreate(order.id, tx);
    });
    const feesBefore = await prisma.orderFee.count({
      where: { orderId: order.id, source: 'ESTIMATE' },
    });
    expect(feesBefore).toBe(2);

    // Maliyet sonradan gelir (Slice C manuel giriş / variant-resolution tick)
    // ve fonksiyon yeniden çağrılır — estimate guard'ı (null) GEÇER; fee'ler
    // feeType-başına skip-if-exists ile İKİNCİ kez yazılmamalı, profit tek
    // fee setiyle hesaplanmalı (regresyon: 2x PSF + 2x Stopaj → yanlış kâr).
    await prisma.orderItem.updateMany({
      where: { orderId: order.id },
      data: { unitCostSnapshotNet: '40.00', unitCostSnapshotVatAmount: '8.00' },
    });
    await prisma.$transaction(async (tx) => {
      await applyEstimateOnOrderCreate(order.id, tx);
    });

    const estimateFees = await prisma.orderFee.groupBy({
      by: ['feeType'],
      where: { orderId: order.id, source: 'ESTIMATE' },
      _count: { _all: true },
    });
    expect(Object.fromEntries(estimateFees.map((f) => [f.feeType, f._count._all]))).toEqual({
      PLATFORM_SERVICE: 1,
      STOPPAGE: 1,
    });
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.estimatedNetProfit).not.toBeNull();
  });

  it('Write-once — re-entry idempotent (estimatedNetProfit set ise no-op)', async () => {
    const { org, store } = await setup();
    const order = await createOrderWithItem({ orgId: org.id, storeId: store.id });

    await prisma.$transaction(async (tx) => {
      await applyEstimateOnOrderCreate(order.id, tx);
    });
    const fees1 = await prisma.orderFee.count({ where: { orderId: order.id } });

    // İkinci çağrı — Order.estimatedNetProfit zaten dolu, fonksiyon early return.
    // OrderFee duplicate YAZILMAMALI.
    await prisma.$transaction(async (tx) => {
      await applyEstimateOnOrderCreate(order.id, tx);
    });
    const fees2 = await prisma.orderFee.count({ where: { orderId: order.id } });

    expect(fees2).toBe(fees1);
  });

  it('kâr-dışı sipariş: re-entry ne fee yazar ne estimate (kalıcı donuk)', async () => {
    const { org, store } = await setup();
    const order = await createOrderWithItem({ orgId: org.id, storeId: store.id });
    await prisma.order.update({
      where: { id: order.id },
      data: { profitExcludedAt: new Date(), profitExclusionReason: 'COST_DEADLINE_MISSED' },
    });

    await prisma.$transaction(async (tx) => {
      await applyEstimateOnOrderCreate(order.id, tx);
    });

    expect(await prisma.orderFee.count({ where: { orderId: order.id } })).toBe(0);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.estimatedNetProfit).toBeNull();
  });

  it('saleSubtotalNet null → Stopaj OrderFee yazılmaz, profit null kalır', async () => {
    const { org, store } = await setup();
    // createOrderWithItem zorla saleSubtotalNet'i set'ler — null senaryosu için
    // direkt order create + items, saleSubtotalNet bırakma.
    const order = await createOrder(org.id, store.id);
    // OrderItem ekle ama saleSubtotalNet null bırak
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: BigInt(Date.now()),
        productMainId: 'pm-null-sale',
        title: 'X',
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: BigInt(Date.now() + 1),
        barcode: 'bc-null',
        stockCode: 'sk-null',
        salePrice: '100',
        listPrice: '120',
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        organizationId: org.id,
        productVariantId: variant.id,
        quantity: 1,
        unitPrice: '120',
        commissionRate: '10',
        commissionAmount: '12',
        unitCostSnapshotNet: '50',
        unitCostSnapshotVatAmount: '10',
      },
    });

    await prisma.$transaction(async (tx) => {
      await applyEstimateOnOrderCreate(order.id, tx);
    });

    const fees = await prisma.orderFee.findMany({ where: { orderId: order.id } });
    // PSF yazılır (saleSubtotalNet'ten bağımsız, deterministic), Stopaj yazılmaz
    // (matrah yok).
    expect(fees.some((f) => f.feeType === 'PLATFORM_SERVICE')).toBe(true);
    expect(fees.some((f) => f.feeType === 'STOPPAGE')).toBe(false);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.estimatedNetProfit).toBeNull();
  });

  // ─── SameDayShipping ("Bugün Kargoda") PSF — 6.99 vs 10.99 (2026-06-14) ──
  // Resmi Trendyol kuralı: 6.99 indirimi YALNIZ fastDeliveryType='SameDayShipping'
  // + aynı-gün SEVK (actualShipDate). Estimate refinable: T+0 optimistik 6.99,
  // sevk re-sync'inde aynı-gün değilse 10.99'a refine. İstanbul-gün karşılaştırması.
  const SDS_ORDER_DATE = new Date('2026-06-12T07:28:45.000Z'); // İST 10:28 → 06-12
  const SDS_SHIP_SAME = new Date('2026-06-12T11:35:54.000Z'); // İST 14:35 → 06-12
  const SDS_SHIP_LATE = new Date('2026-06-13T05:00:00.000Z'); // İST 08:00 → 06-13

  async function psfOf(orderId: string) {
    return prisma.orderFee.findFirstOrThrow({
      where: { orderId, feeType: 'PLATFORM_SERVICE', source: 'ESTIMATE' },
    });
  }

  it('SameDayShipping + henüz sevk yok → optimistik PSF 6.99', async () => {
    const { org, store } = await setup();
    const order = await createOrderWithItem({
      orgId: org.id,
      storeId: store.id,
      fastDeliveryType: 'SameDayShipping',
      actualShipDate: null,
      orderDate: SDS_ORDER_DATE,
    });

    await prisma.$transaction((tx) => applyEstimateOnOrderCreate(order.id, tx));

    const psf = await psfOf(order.id);
    expect(new Decimal(psf.amountNet).toString()).toBe('6.99');
    expect(new Decimal(psf.vatAmount).toString()).toBe('1.4'); // 6.99 × %20
    expect(psf.displayName).toContain('Bugün Kargoda');
  });

  it('SameDayShipping + aynı gün sevk → PSF 6.99 (hak edildi)', async () => {
    const { org, store } = await setup();
    const order = await createOrderWithItem({
      orgId: org.id,
      storeId: store.id,
      fastDeliveryType: 'SameDayShipping',
      actualShipDate: SDS_SHIP_SAME,
      orderDate: SDS_ORDER_DATE,
    });

    await prisma.$transaction((tx) => applyEstimateOnOrderCreate(order.id, tx));

    expect(new Decimal((await psfOf(order.id)).amountNet).toString()).toBe('6.99');
  });

  it('SameDayShipping + geç (ertesi gün) sevk → PSF 10.99 (hak EDİLMEDİ)', async () => {
    const { org, store } = await setup();
    const order = await createOrderWithItem({
      orgId: org.id,
      storeId: store.id,
      fastDeliveryType: 'SameDayShipping',
      actualShipDate: SDS_SHIP_LATE,
      orderDate: SDS_ORDER_DATE,
    });

    await prisma.$transaction((tx) => applyEstimateOnOrderCreate(order.id, tx));

    expect(new Decimal((await psfOf(order.id)).amountNet).toString()).toBe('10.99');
  });

  it('FastDelivery → PSF 10.99 (6.99 indirimi SADECE SameDayShipping)', async () => {
    const { org, store } = await setup();
    const order = await createOrderWithItem({
      orgId: org.id,
      storeId: store.id,
      fastDeliveryType: 'FastDelivery',
      actualShipDate: SDS_SHIP_SAME, // aynı gün sevk olsa bile FastDelivery indirim almaz
      orderDate: SDS_ORDER_DATE,
    });

    await prisma.$transaction((tx) => applyEstimateOnOrderCreate(order.id, tx));

    expect(new Decimal((await psfOf(order.id)).amountNet).toString()).toBe('10.99');
  });

  it('refine: SameDayShipping T+0 optimistik 6.99 → geç sevk re-sync → 10.99 (tek PSF satırı)', async () => {
    const { org, store } = await setup();
    const order = await createOrderWithItem({
      orgId: org.id,
      storeId: store.id,
      fastDeliveryType: 'SameDayShipping',
      actualShipDate: null,
      orderDate: SDS_ORDER_DATE,
    });

    // T+0: henüz sevk yok → optimistik 6.99
    await prisma.$transaction((tx) => applyEstimateOnOrderCreate(order.id, tx));
    expect(new Decimal((await psfOf(order.id)).amountNet).toString()).toBe('6.99');

    // Sevk re-sync: geç (ertesi gün) sevk → 10.99'a refine, ÇİFT satır YOK
    await prisma.order.update({ where: { id: order.id }, data: { actualShipDate: SDS_SHIP_LATE } });
    await prisma.$transaction((tx) => applyEstimateOnOrderCreate(order.id, tx));

    const psfRows = await prisma.orderFee.findMany({
      where: { orderId: order.id, feeType: 'PLATFORM_SERVICE', source: 'ESTIMATE' },
    });
    expect(psfRows).toHaveLength(1);
    expect(new Decimal(psfRows[0]!.amountNet).toString()).toBe('10.99');
  });
});
