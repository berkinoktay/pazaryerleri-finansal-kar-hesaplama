import { Decimal } from 'decimal.js';
import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  applyEstimateOnOrderCreate,
  buildProfitBreakdown,
  type ProfitBreakdownFeeInput,
  type ProfitBreakdownItemInput,
} from '@pazarsync/profit';
import type { OrderFeeType } from '@pazarsync/db/enums';

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
    // GROSS konvansiyon (2026-06-16): saleGross (KDV-dahil satış) + saleVat.
    saleGross?: string;
    saleVat?: string;
    status?: 'DELIVERED' | 'RETURNED';
    micro?: boolean;
    // GROSS maliyet snapshot'ı: unitCostSnapshotGross (KDV-dahil) + oran.
    unitCostSnapshotGross?: string | null;
    unitCostSnapshotVatRate?: string | null;
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
        // saleGross 120 = net 100 + KDV 20 (eski saleSubtotalNet 100 / saleVatTotal 20).
        saleGross: args.saleGross ?? '120.00',
        saleVat: args.saleVat ?? '20.00',
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
        // GROSS konvansiyon: lineSaleGross 120 (KDV-dahil satış), commissionGross 12
        // (net 10 + KDV 2), unitCostSnapshotGross 60 (net 50 + KDV 10), oranlar %20.
        lineSaleGross: '120',
        commissionRate: '10',
        commissionGross: '12',
        commissionVatRate: '20',
        unitCostSnapshotGross:
          args.unitCostSnapshotGross !== undefined ? args.unitCostSnapshotGross : '60',
        unitCostSnapshotVatRate:
          args.unitCostSnapshotVatRate !== undefined ? args.unitCostSnapshotVatRate : '20',
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
    expect(new Decimal(shippingFee!.amountGross).gt(0)).toBe(true);

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
      saleGross: '120.00',
      saleVat: '20.00',
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
    // GROSS: amountGross 13.19 = net 10.99 × 1.20 (vatRate %20).
    expect(new Decimal(psf.amountGross).toString()).toBe('13.19');
    expect(new Decimal(psf.vatRate).toString()).toBe('20');
    expect(psf.source).toBe('ESTIMATE');
    expect(psf.direction).toBe('DEBIT');

    const stopaj = fees.find((f) => f.feeType === 'STOPPAGE')!;
    // Stopaj matrahı NET satış (KDV-hariç): (saleGross 120 − saleVat 20) × %1 = 1.00;
    // vatRate 0 (stopaj KDV taşımaz). Eski hata: gross 120 × %1 = 1.20 (KDV de matraha
    // giriyordu); rakip/Trendyol gerçek değeri net üzerinden.
    expect(new Decimal(stopaj.amountGross).toString()).toBe('1');
    expect(new Decimal(stopaj.vatRate).toString()).toBe('0');

    // Profit = effectiveSale − itemCost − commission − PSF − Stopaj − NetKDV (net terimler)
    //       = 100 − 50 − 10 − 10.99 − 1.20 − ... ; motor gross'tan algebraik aynı net kârı üretir.
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.estimatedNetProfit).not.toBeNull();
    // Net KDV persist edildi (writer'ı pinler): saleVat − costVat − commVat − PSFvat
    //                                          = 20 − 10 − 2 − 2.20 = 5.80
    expect(updated.estimatedNetVat).not.toBeNull();
    expect(new Decimal(updated.estimatedNetVat!).toString()).toBe('5.8');
  });

  it('stopaj NET satış üzerinden hesaplanır (gross DEĞİL) — sipariş 11328013993', async () => {
    // Canlı sipariş 11328013993: saleGross 313.50, saleVat 28.50 → net 285.00.
    // DOĞRU stopaj = net 285.00 × %1 = 2.85 (rakip + Trendyol gerçek).
    // ESKİ HATA: gross 313.50 × %1 = 3.14 (KDV de matraha giriyordu) → kâr 0.29 eksik.
    const { org, store } = await setup();
    const order = await createOrderWithItem({
      orgId: org.id,
      storeId: store.id,
      saleGross: '313.50',
      saleVat: '28.50',
    });

    await prisma.$transaction((tx) => applyEstimateOnOrderCreate(order.id, tx));

    const stopaj = await prisma.orderFee.findFirstOrThrow({
      where: { orderId: order.id, feeType: 'STOPPAGE', source: 'ESTIMATE' },
    });
    // NET 285.00 × %1 = 2.85; KESİNLİKLE gross 313.50 × %1 = 3.14 DEĞİL.
    expect(new Decimal(stopaj.amountGross).toString()).toBe('2.85');
    expect(new Decimal(stopaj.amountGross).toString()).not.toBe('3.14');
    expect(new Decimal(stopaj.vatRate).toString()).toBe('0');
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
      unitCostSnapshotGross: null,
      unitCostSnapshotVatRate: null,
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
      unitCostSnapshotGross: null,
      unitCostSnapshotVatRate: null,
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
      data: { unitCostSnapshotGross: '48.00', unitCostSnapshotVatRate: '20.00' },
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
        // GROSS: lineSaleGross 120, commissionGross 12, unitCostSnapshotGross 60 (oran %20).
        lineSaleGross: '120',
        commissionRate: '10',
        commissionGross: '12',
        commissionVatRate: '20',
        unitCostSnapshotGross: '60',
        unitCostSnapshotVatRate: '20',
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
    // GROSS: amountGross 8.39 = net 6.99 × 1.20 (vatRate %20).
    expect(new Decimal(psf.amountGross).toString()).toBe('8.39');
    expect(new Decimal(psf.vatRate).toString()).toBe('20');
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

    expect(new Decimal((await psfOf(order.id)).amountGross).toString()).toBe('8.39');
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

    expect(new Decimal((await psfOf(order.id)).amountGross).toString()).toBe('13.19');
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

    expect(new Decimal((await psfOf(order.id)).amountGross).toString()).toBe('13.19');
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
    expect(new Decimal((await psfOf(order.id)).amountGross).toString()).toBe('8.39');

    // Sevk re-sync: geç (ertesi gün) sevk → 10.99'a refine, ÇİFT satır YOK
    await prisma.order.update({ where: { id: order.id }, data: { actualShipDate: SDS_SHIP_LATE } });
    await prisma.$transaction((tx) => applyEstimateOnOrderCreate(order.id, tx));

    const psfRows = await prisma.orderFee.findMany({
      where: { orderId: order.id, feeType: 'PLATFORM_SERVICE', source: 'ESTIMATE' },
    });
    expect(psfRows).toHaveLength(1);
    expect(new Decimal(psfRows[0]!.amountGross).toString()).toBe('13.19');
  });

  // ─── Multi-item KDV mutabakatı (Bug 1: per-line yuvarlama → bileşik kayma) ──
  // Çok kalemli siparişte cost/komisyon KDV'si TAM PRECISION'da biriktirilmeli,
  // persist'te BİR kez yuvarlanmalı. Eski kod her satırı `.toDecimalPlaces(2)`
  // ile yuvarlayıp topladığından saklanan estimatedNetVat görünüm dökümünden
  // (build-profit-breakdown raw-aggregate) bir kuruş sapabiliyordu.
  //
  // Senaryo: 3 maliyet satırı × birim 10.05 @%20 → per-line VAT 1.675 → yuvarlanırsa
  // 1.68 ×3 = 5.04; raw 1.675×3 = 5.025 → 5.03. 1 kuruş fark = bu testin yakaladığı.
  describe('multi-item KDV mutabakatı (estimate ↔ display breakdown)', () => {
    async function createMultiItemOrder(args: {
      orgId: string;
      storeId: string;
      // [unitCostSnapshotGross, quantity, vatRate]
      costLines: Array<{ unitCostGross: string; quantity: number; costVatRate: string }>;
      saleGross: string;
      saleVat: string;
      // commission per line
      commissionGross: string;
      commissionVatRate: string;
    }) {
      const order = await createOrder(args.orgId, args.storeId, { status: 'DELIVERED' });
      await prisma.order.update({
        where: { id: order.id },
        data: { saleGross: args.saleGross, saleVat: args.saleVat },
      });
      const product = await prisma.product.create({
        data: {
          organizationId: args.orgId,
          storeId: args.storeId,
          platformContentId: BigInt(Date.now() + Math.floor(Math.random() * 100000)),
          productMainId: `pm-${order.id.slice(0, 8)}`,
          title: 'Multi Test Product',
        },
      });
      let variantSeq = 0;
      for (const line of args.costLines) {
        variantSeq += 1;
        const variant = await prisma.productVariant.create({
          data: {
            organizationId: args.orgId,
            storeId: args.storeId,
            productId: product.id,
            platformVariantId: BigInt(Date.now() + Math.floor(Math.random() * 100000) + variantSeq),
            barcode: `bc-${order.id.slice(0, 6)}-${variantSeq}`,
            stockCode: `sk-${order.id.slice(0, 6)}-${variantSeq}`,
            salePrice: '100',
            listPrice: '120',
          },
        });
        await prisma.orderItem.create({
          data: {
            orderId: order.id,
            organizationId: args.orgId,
            productVariantId: variant.id,
            quantity: line.quantity,
            lineSaleGross: args.saleGross,
            commissionRate: '10',
            commissionGross: args.commissionGross,
            commissionVatRate: args.commissionVatRate,
            refundedCommissionGross: '0',
            unitCostSnapshotGross: line.unitCostGross,
            unitCostSnapshotVatRate: line.costVatRate,
          },
        });
      }
      return order;
    }

    it('saklanan estimatedNetVat = display breakdown raw-aggregate KDV (per-line yuvarlama YOK)', async () => {
      const { org, store } = await setup();
      const order = await createMultiItemOrder({
        orgId: org.id,
        storeId: store.id,
        // 3 satır × 10.05 @%20 → tam mutabakat sapma testi.
        costLines: [
          { unitCostGross: '10.05', quantity: 1, costVatRate: '20' },
          { unitCostGross: '10.05', quantity: 1, costVatRate: '20' },
          { unitCostGross: '10.05', quantity: 1, costVatRate: '20' },
        ],
        saleGross: '120.00',
        saleVat: '20.00',
        commissionGross: '4.00',
        commissionVatRate: '20',
      });

      await prisma.$transaction((tx) => applyEstimateOnOrderCreate(order.id, tx));

      const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updated.estimatedNetProfit).not.toBeNull();
      expect(updated.estimatedNetVat).not.toBeNull();

      // Aynı kalıcı gross girdilerden display dökümünü kur (raw-aggregate yol).
      const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
      const fees = await prisma.orderFee.findMany({
        where: { orderId: order.id, source: 'ESTIMATE' },
      });
      const breakdownItems: ProfitBreakdownItemInput[] = items.map((i) => ({
        quantity: i.quantity,
        lineListGross: null,
        lineSaleGross: i.lineSaleGross === null ? null : new Decimal(i.lineSaleGross),
        lineSellerDiscountGross: null,
        saleVatRate: Number(i.saleVatRate ?? 0),
        commissionGross: new Decimal(i.commissionGross),
        refundedCommissionGross: new Decimal(i.refundedCommissionGross),
        commissionVatRate: Number(i.commissionVatRate),
        unitCostSnapshotGross:
          i.unitCostSnapshotGross === null ? null : new Decimal(i.unitCostSnapshotGross),
        unitCostSnapshotVatRate: Number(i.unitCostSnapshotVatRate ?? 0),
      }));
      const breakdownFees: ProfitBreakdownFeeInput[] = fees.map((f) => ({
        feeType: f.feeType as OrderFeeType,
        direction: f.direction,
        amountGross: new Decimal(f.amountGross),
        vatRate: Number(f.vatRate),
        source: f.source,
      }));

      const view = buildProfitBreakdown({
        saleGross: new Decimal(updated.saleGross!),
        saleVat: new Decimal(updated.saleVat!),
        listGross: new Decimal(updated.listGross ?? 0),
        sellerDiscountGross: new Decimal(updated.sellerDiscountGross ?? 0),
        items: breakdownItems,
        fees: breakdownFees,
        netProfit: new Decimal(updated.estimatedNetProfit!),
        netVat: new Decimal(updated.estimatedNetVat!),
        saleMarginPct: null,
        costMarkupPct: null,
      });

      // RAW-aggregate Net KDV'yi kalıcı gross girdilerden bağımsızca yeniden kur —
      // build-profit-breakdown'ın iç toplama yöntemiyle AYNI (her KDV bileşeni TAM
      // precision'da biriktirilir, tek yuvarlama en sonda). Per-line yuvarlama yapan
      // ESKİ kod bu raw değerden bir kuruş sapardı.
      const grossToVat = (gross: Decimal, ratePct: number): Decimal =>
        ratePct === 0 ? new Decimal(0) : gross.mul(ratePct).div(100 + ratePct);
      let rawCostVat = new Decimal(0);
      let rawCommVat = new Decimal(0);
      for (const i of breakdownItems) {
        const lineCost = (i.unitCostSnapshotGross ?? new Decimal(0)).mul(i.quantity);
        rawCostVat = rawCostVat.add(grossToVat(lineCost, i.unitCostSnapshotVatRate));
        const effComm = i.commissionGross.sub(i.refundedCommissionGross);
        rawCommVat = rawCommVat.add(grossToVat(effComm, i.commissionVatRate));
      }
      let rawFeeVat = new Decimal(0);
      for (const f of breakdownFees) {
        if (f.feeType === 'SHIPPING' || f.feeType === 'PLATFORM_SERVICE') {
          const signed = f.direction === 'DEBIT' ? 1 : -1;
          rawFeeVat = rawFeeVat.add(grossToVat(f.amountGross, f.vatRate).mul(signed));
        }
      }
      const rawDerivedNetVat = new Decimal(updated.saleVat!)
        .sub(rawCostVat)
        .sub(rawCommVat)
        .sub(rawFeeVat)
        .toDecimalPlaces(2);

      // 1) Saklanan estimatedNetVat == raw-aggregate (round-once) Net KDV. BİREBİR.
      //    Per-line yuvarlamalı eski kod burada sapardı.
      expect(new Decimal(updated.estimatedNetVat!).toFixed(2)).toBe(rawDerivedNetVat.toFixed(2));

      // 2) Bileşik kayma yok: display costVat 3×10.05@%20 raw = 5.03
      //    (per-line yuvarlama 1.68×3 = 5.04 verirdi).
      expect(view.costVat).toBe('5.03');
      expect(rawCostVat.toDecimalPlaces(2).toFixed(2)).toBe('5.03');

      // 3) Σ düşülen gross terimler + Net KDV = saleGross − netProfit (mutabakat kapanır;
      //    netProfit motor tarafından TAM precision raw KDV'den üretildi).
      const sumOfDeductions = new Decimal(view.costGross)
        .add(view.commissionGross)
        .add(view.shippingGross)
        .add(view.platformServiceGross)
        .add(view.stoppage)
        .add(view.netVat);
      expect(sumOfDeductions.toFixed(2)).toBe(
        new Decimal(view.saleGross).sub(view.netProfit).toFixed(2),
      );
    });
  });
});
