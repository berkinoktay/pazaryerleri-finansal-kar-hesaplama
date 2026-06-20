// Integration tests for the Sale / Discount / Return settlement handlers
// (PR-7 commit 3). Real DB + Decimal arithmetic + idempotency assertions.

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import type { TrendyolFinancialTransaction } from '@pazarsync/marketplace';
import { syncLog } from '@pazarsync/sync-core';

import { handleDiscount, handleReturn, handleSale } from '../../src/handlers/settlements';

import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import { ensureFeeDefinitions } from '../../../../apps/api/tests/helpers/seed-fee-definitions';

const BARCODE = 'EAN13-001';
const SHIPMENT_PACKAGE_ID = 999_123_456;

function makeSettlementRow(
  overrides: Partial<TrendyolFinancialTransaction> = {},
): TrendyolFinancialTransaction {
  return {
    id: '725041340',
    transactionDate: 1715000000000,
    barcode: BARCODE,
    transactionType: 'Satış',
    receiptId: 48376618,
    description: 'Satış',
    debt: 0,
    credit: 120,
    paymentPeriod: 30,
    commissionRate: 10,
    commissionAmount: 12, // 10% of 120 → KDV-dahil; net = 10, vat = 2
    commissionInvoiceSerialNumber: 'DCF2026001708462',
    sellerRevenue: 108,
    orderNumber: '11101228439',
    paymentOrderId: null,
    paymentDate: null,
    sellerId: 123456,
    storeId: null,
    storeName: null,
    storeAddress: null,
    country: 'Türkiye',
    orderDate: 1715000000000,
    affiliate: 'TRENDYOLTR',
    shipmentPackageId: SHIPMENT_PACKAGE_ID,
    ...overrides,
  };
}

async function buildOrderWithItem(opts?: {
  withCostAndSale?: boolean;
  /** Line quantity — sale/commission/cost aggregates scale with it (default 1). */
  quantity?: number;
  /**
   * Seed a NON-zero frozen refunded-commission estimate (default '0'). Used by
   * the handleDiscount freeze test so the settled-vs-estimate assertion is
   * discriminating — the working column is overwritten to a DIFFERENT value.
   */
  estimatedRefundedGross?: string;
}): Promise<{
  storeId: string;
  orderId: string;
  itemId: string;
  variantId: string;
}> {
  const quantity = opts?.quantity ?? 1;
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      productMainId: `main-${randomUUID().slice(0, 8)}`,
      title: 'Test',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      barcode: BARCODE,
      stockCode: `SKU-${randomUUID().slice(0, 8)}`,
      salePrice: new Decimal('120.00'),
      listPrice: new Decimal('120.00'),
    },
  });

  // createOrder factory doesn't expose platformOrderId override — inline
  // create so the handler's `(storeId, platformOrderId)` lookup matches.
  // GROSS CONVENTION: saleGross/saleVat (not saleSubtotalNet/saleVatTotal).
  const order = await prisma.order.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformOrderId: SHIPMENT_PACKAGE_ID.toString(),
      platformOrderNumber: '11101228439',
      orderDate: new Date(),
      status: 'DELIVERED',
      // Sale aggregate enables recomputeSettledProfit in the Return trio
      // test (it skips on null aggregates — old fixtures keep that path).
      // Per-unit base: 120 gross sale (100 net + 20 VAT), 50 settled profit
      // — scaled by quantity so the qty>1 partial-return test composes.
      ...(opts?.withCostAndSale === true
        ? {
            saleGross: new Decimal('120.00').mul(quantity),
            saleVat: new Decimal('20.00').mul(quantity),
            // Payment cycle already ran (settled figure exists) — the
            // late-return refresh path is the one under test.
            settledNetProfit: new Decimal('50.00').mul(quantity),
          }
        : {}),
    },
  });

  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      organizationId: org.id,
      productVariantId: variant.id,
      quantity,
      // GROSS CONVENTION: lineSaleGross/lineListGross/commissionGross etc.
      lineListGross: new Decimal('120.00').mul(quantity),
      lineSaleGross: new Decimal('120.00').mul(quantity),
      lineSellerDiscountGross: new Decimal('0'),
      saleVatRate: new Decimal('20.00'),
      commissionRate: new Decimal('10.00'),
      commissionVatRate: new Decimal('20.00'),
      // commissionGross LINE-level (× quantity). Pre-filled so that
      // CHECK constraint (refundedCommissionGross <= commissionGross)
      // tolerates the Discount handler writes in the happy-path test.
      commissionGross: new Decimal('12.00').mul(quantity),
      refundedCommissionGross: new Decimal('0'),
      // estimatedCommissionGross = T+0 snapshot (write-once). Settlement
      // handler overwrites settledCommissionGross but leaves this intact.
      estimatedCommissionGross: new Decimal('12.00').mul(quantity),
      ...(opts?.estimatedRefundedGross !== undefined
        ? { refundedCommissionGross: new Decimal(opts.estimatedRefundedGross) }
        : {}),
      ...(opts?.withCostAndSale === true
        ? {
            unitCostSnapshotGross: new Decimal('48.00'), // 40 net + 8 VAT gross
            unitCostSnapshotVatRate: new Decimal('20.00'),
          }
        : {}),
    },
  });

  return { storeId: store.id, orderId: order.id, itemId: item.id, variantId: variant.id };
}

/**
 * #299 fixtures: a synced OrderClaim with N per-unit claim items, all
 * pointing at the given OrderItem (Trendyol emits one claimItem per UNIT).
 */
async function createClaimWithUnits(args: {
  storeId: string;
  orderId: string;
  orderItemId: string;
  units: number;
}): Promise<{ claimId: string; claimItemIds: string[] }> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: args.orderId },
    select: { organizationId: true },
  });
  const claim = await prisma.orderClaim.create({
    data: {
      organizationId: order.organizationId,
      storeId: args.storeId,
      orderId: args.orderId,
      trendyolClaimId: randomUUID(),
      claimDate: new Date(),
      resolved: false,
    },
  });
  const claimItemIds: string[] = [];
  for (let i = 0; i < args.units; i += 1) {
    const item = await prisma.orderClaimItem.create({
      data: {
        claimId: claim.id,
        orderItemId: args.orderItemId,
        trendyolClaimItemId: randomUUID(),
        reasonCode: 'DAMAGEDITEM',
        reasonName: 'Hasarlı ürün',
        status: 'Created',
        acceptedBySeller: false,
        resolved: false,
      },
    });
    claimItemIds.push(item.id);
  }
  return { claimId: claim.id, claimItemIds };
}

describe('settlement handlers', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    // Settlement handler'ları komisyon KDV oranını fee_definitions
    // ALL/COMMISSION_INVOICE'tan çözer (denetim A) → seed gerekir.
    await ensureFeeDefinitions();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  // ─── handleSale ──────────────────────────────────────────────────────

  describe('handleSale', () => {
    it('updates OrderItem settledCommissionGross + commissionInvoiceSerialNumber + settledSaleAmount', async () => {
      const { storeId, itemId } = await buildOrderWithItem();
      const row = makeSettlementRow({ commissionAmount: 12 });

      await prisma.$transaction(async (tx) => {
        const result = await handleSale(storeId, row, tx);
        expect(result.applied).toBe(true);
      });

      const updated = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } });
      // GROSS CONVENTION: commissionAmount 12 KDV-dahil × qty(1) = 12
      expect(updated.settledCommissionGross?.toFixed(2)).toBe('12.00');
      expect(updated.commissionInvoiceSerialNumber).toBe('DCF2026001708462');
      // FK stays null — commit 6 (CommissionInvoice synthesis) will backfill.
      expect(updated.commissionInvoiceId).toBeNull();
      // Hakediş Kontrolü temeli: Trendyol'un kredilediği gerçek satış (credit 120)
      // çıpa olarak yakalandı — kâra GİRMEZ, yalnız gelecek mutabakat için.
      expect(updated.settledSaleAmount?.toFixed(2)).toBe('120.00');
    });

    it('preserves the commission ESTIMATE when settlement overwrites the actual (different value)', async () => {
      const { storeId, itemId } = await buildOrderWithItem(); // qty=1, estimate gross=12
      // Settlement commission DIFFERS from the T+0 estimate: commissionAmount 18 gross.
      const row = makeSettlementRow({ commissionAmount: 18 });

      await prisma.$transaction(async (tx) => {
        expect((await handleSale(storeId, row, tx)).applied).toBe(true);
      });

      const updated = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } });
      // ACTUAL overwritten to the settled gross value...
      expect(updated.settledCommissionGross?.toFixed(2)).toBe('18.00');
      // ...but the ESTIMATE is FROZEN at T+0 (12) — Hakediş Kontrolü tahmin-vs-gerçek.
      expect(updated.estimatedCommissionGross?.toFixed(2)).toBe('12.00');
    });

    it('qty>1: scales settledCommissionGross + settledSaleAmount by quantity (N özdeş per-unit Sale satırı → line-toplamı); estimate frozen; idempotent', async () => {
      // EMPİRİK (2026-06-14): Trendyol qty=3 için 3 ÖZDEŞ per-unit Sale satırı
      // gönderir (her credit=120 birim liste). Handler her satırı × quantity ile
      // line-toplamına çıkarır → overwrite idempotent. commissionAmount 18 SEÇİLDİ
      // ki settled çalışan değer (54) donuk tahminden (12×3=36) FARKLI olsun →
      // tahminin DONDURULDUĞU (ve yeniden ÖLÇEKLENMEDİĞİ) ayırt edici kanıtlanır.
      const { storeId, itemId } = await buildOrderWithItem({ quantity: 3 });
      const row = makeSettlementRow({ commissionAmount: 18, credit: 120 });

      await prisma.$transaction(async (tx) => {
        expect((await handleSale(storeId, row, tx)).applied).toBe(true);
      });
      let updated = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } });
      // GROSS: 18 × 3 = 54 (per-unit gross × quantity); credit 120 × 3 = 360
      expect(updated.settledCommissionGross?.toFixed(2)).toBe('54.00');
      expect(updated.settledSaleAmount?.toFixed(2)).toBe('360.00');
      // Tahmin DONUK: line-toplamı 12×3=36; settled 54'e RE-SCALE EDİLMEDİ.
      expect(updated.estimatedCommissionGross?.toFixed(2)).toBe('36.00');

      // Idempotent: aynı (veya kardeş özdeş) satırı tekrar uygulamak line-toplamını korur.
      await prisma.$transaction(async (tx) => {
        expect((await handleSale(storeId, row, tx)).applied).toBe(true);
      });
      updated = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } });
      expect(updated.settledCommissionGross?.toFixed(2)).toBe('54.00');
      expect(updated.settledSaleAmount?.toFixed(2)).toBe('360.00');
      expect(updated.estimatedCommissionGross?.toFixed(2)).toBe('36.00');
    });

    it('skips with sparse_field when shipmentPackageId is null', async () => {
      const { storeId } = await buildOrderWithItem();
      const row = makeSettlementRow({ shipmentPackageId: null });

      await prisma.$transaction(async (tx) => {
        const result = await handleSale(storeId, row, tx);
        expect(result).toEqual({ applied: false, skipReason: 'sparse_field' });
      });
    });

    it('skips with order_not_found when shipmentPackageId has no matching Order', async () => {
      const { storeId } = await buildOrderWithItem();
      const row = makeSettlementRow({ shipmentPackageId: 999999 });

      await prisma.$transaction(async (tx) => {
        const result = await handleSale(storeId, row, tx);
        expect(result).toEqual({ applied: false, skipReason: 'order_not_found' });
      });
    });

    it('skips with variant_not_found when barcode is unmapped', async () => {
      const { storeId } = await buildOrderWithItem();
      const row = makeSettlementRow({ barcode: 'UNKNOWN-BARCODE' });

      await prisma.$transaction(async (tx) => {
        const result = await handleSale(storeId, row, tx);
        expect(result).toEqual({ applied: false, skipReason: 'variant_not_found' });
      });
    });
  });

  // ─── handleDiscount ───────────────────────────────────────────────────

  describe('handleDiscount', () => {
    it('updates refundedCommissionGross (NOT lineSellerDiscountGross — intake is authoritative)', async () => {
      const { storeId, itemId } = await buildOrderWithItem();
      // Discount: commissionAmount = refunded commission KDV-dahil (gross per-unit).
      // lineSellerDiscountGross (48.01 from discountDetails) must NOT be overwritten.
      const row = makeSettlementRow({
        transactionType: 'İndirim',
        debt: 24,
        credit: 0,
        commissionAmount: 6,
      });
      // capture lineSellerDiscountGross before handler runs
      const before = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } });

      await prisma.$transaction(async (tx) => {
        const result = await handleDiscount(storeId, row, tx);
        expect(result.applied).toBe(true);
      });

      const updated = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } });
      // GROSS CONVENTION: commissionAmount 6 KDV-dahil × qty(1) = 6
      expect(updated.refundedCommissionGross?.toFixed(2)).toBe('6.00');
      // lineSellerDiscountGross UNTOUCHED — intake discountDetails is authoritative
      expect(updated.lineSellerDiscountGross.toFixed(2)).toBe(
        before.lineSellerDiscountGross.toFixed(2),
      );
    });

    it('preserves the refunded-commission ESTIMATE when settlement overwrites the actual (different value)', async () => {
      // Simetrik yarı (handleSale dondurma testinin aynası): Discount handler çalışan
      // refundedCommissionGross'u GERÇEKLE ezerken donuk tahminlere DOKUNMAMALI.
      // Tahmin SIFIR-OLMAYAN ('3.00') ekilir → settled değerden (6) ayırt edici.
      const { storeId, itemId } = await buildOrderWithItem({ estimatedRefundedGross: '3.00' });
      const row = makeSettlementRow({
        transactionType: 'İndirim',
        debt: 24,
        credit: 0,
        commissionAmount: 6, // refunded commission KDV-dahil gross 6 (≠ tahmin 3)
      });

      await prisma.$transaction(async (tx) => {
        expect((await handleDiscount(storeId, row, tx)).applied).toBe(true);
      });

      const updated = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } });
      // ACTUAL overwritten to the settled gross value...
      expect(updated.refundedCommissionGross?.toFixed(2)).toBe('6.00');
      // ...but lineSellerDiscountGross intake stays untouched (per Task 18 invariant).
    });

    it('qty>1: scales refundedCommissionGross by quantity (line-toplamı); lineSellerDiscountGross unchanged', async () => {
      // Trendyol qty=3 için 3 per-unit Discount satırı; handler × quantity ile
      // line-toplamına çıkarır. CHECK refunded ≤ gross: fixture gross=12×3=36, refunded=18 ✓.
      const { storeId, itemId } = await buildOrderWithItem({ quantity: 3 });
      const row = makeSettlementRow({
        transactionType: 'İndirim',
        debt: 24,
        credit: 0,
        commissionAmount: 6,
      });
      const before = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } });

      await prisma.$transaction(async (tx) => {
        expect((await handleDiscount(storeId, row, tx)).applied).toBe(true);
      });

      const updated = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } });
      // GROSS: 6 × 3 = 18 (per-unit gross × quantity)
      expect(updated.refundedCommissionGross?.toFixed(2)).toBe('18.00');
      // lineSellerDiscountGross UNTOUCHED — intake is always authoritative
      expect(updated.lineSellerDiscountGross.toFixed(2)).toBe(
        before.lineSellerDiscountGross.toFixed(2),
      );
    });

    // PR-C orphan invariant: a Discount row whose order was hard-skipped
    // (PR-B calculability gate) finds no local Order. It must silent-skip —
    // never throw — and emit a structured worker log (never surfaced to the
    // seller). Symmetric with the handleSale + handleReturn order_not_found
    // cases above.
    it('skips with order_not_found + structured warn when Order is missing', async () => {
      const { storeId } = await buildOrderWithItem();
      const row = makeSettlementRow({
        transactionType: 'İndirim',
        debt: 24,
        credit: 0,
        commissionAmount: 6,
        shipmentPackageId: 999999,
      });
      const warnSpy = vi.spyOn(syncLog, 'warn');

      const result = await prisma.$transaction((tx) => handleDiscount(storeId, row, tx));

      expect(result).toEqual({ applied: false, skipReason: 'order_not_found' });
      expect(warnSpy).toHaveBeenCalledWith(
        'settlements.discount.order-not-found',
        expect.objectContaining({ platformOrderId: '999999' }),
      );
    });

    // CHECK constraint `refunded <= gross` is a schema-level invariant
    // covered in apps/api/tests/integration/db/order-item-profit-calc-split.test.ts.
    // Handler scope is the write semantics; constraint enforcement is the DB's.
  });

  // ─── handleReturn ─────────────────────────────────────────────────────

  describe('handleReturn', () => {
    it('writes the full trio (REFUND_DEDUCTION + COMMISSION_REFUND + COST_RETURN) with GROSS amounts + refreshes settled profit', async () => {
      // Issue #291 money-trail proof: Trendyol nets the commission inside
      // the Return row, and the returned unit's cost never materialized.
      // GROSS convention: row.debt=120 (KDV-dahil) → REFUND_DEDUCTION amountGross=120;
      // commissionAmount=12 → COMMISSION_REFUND amountGross=12;
      // unitCostSnapshotGross=48 → COST_RETURN amountGross=48.
      // settledNetProfit is refreshed — recomputeSettledProfit uses saleGross
      // (HAK EDİLEN) as base; return legs land as audit fees (not in computeProfit
      // input — "iade-leg'leri ayrı feeType → motor input'una girmez").
      const { storeId, orderId } = await buildOrderWithItem({ withCostAndSale: true });
      const row = makeSettlementRow({ transactionType: 'İade', debt: 120, credit: 0 });

      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result.applied).toBe(true);
      });

      const fees = await prisma.orderFee.findMany({
        where: { orderId },
        orderBy: { feeType: 'asc' },
      });
      expect(fees.map((f) => f.feeType).sort()).toEqual([
        'COMMISSION_REFUND',
        'COST_RETURN',
        'REFUND_DEDUCTION',
      ]);
      // #297: every leg stamps the identity column — without it the
      // settlement partial unique never applies and dedupe silently breaks.
      expect(fees.map((f) => f.trendyolTransactionId)).toEqual([row.id, row.id, row.id]);

      const refund = fees.find((f) => f.feeType === 'REFUND_DEDUCTION')!;
      expect(refund.direction).toBe('DEBIT');
      // GROSS CONVENTION: row.debt=120 KDV-dahil → amountGross=120; vatRate from saleVatRate (20%)
      expect(refund.amountGross.toFixed(2)).toBe('120.00');
      expect(refund.vatRate.toFixed(2)).toBe('20.00');
      expect(refund.feeDefinitionId).toBeNull();
      expect(refund.externalRef).toMatchObject({
        trendyolId: row.id,
        sellerId: row.sellerId,
        receiptId: row.receiptId,
      });

      const commission = fees.find((f) => f.feeType === 'COMMISSION_REFUND')!;
      expect(commission.direction).toBe('CREDIT');
      // commissionAmount 12 KDV-dahil → amountGross=12; vatRate=20 (from fee-definition)
      expect(commission.amountGross.toFixed(2)).toBe('12.00');
      expect(commission.vatRate.toFixed(2)).toBe('20.00');
      expect(commission.externalRef).toMatchObject({ trendyolId: row.id });

      const costReturn = fees.find((f) => f.feeType === 'COST_RETURN')!;
      expect(costReturn.direction).toBe('CREDIT');
      // one UNIT's cost snapshot: unitCostSnapshotGross=48 (40 net + 8 VAT), vatRate=20%
      expect(costReturn.amountGross.toFixed(2)).toBe('48.00');
      expect(costReturn.vatRate.toFixed(2)).toBe('20.00');

      // Orphan-fee fix: the handler refreshes the ALREADY-SETTLED figure itself
      // (fixture pre-sets 50.00 as the payment cycle's output) — no PaymentOrder
      // re-poll needed. İade-kâra-yansıtma (2026-06): recompute artık iade
      // bacaklarını computeProfit'e KATLAR (per-leg prefer-actual). TAM iade →
      // sale 120-120=0, cost 48-48=0, commission 12-12=0; kalıcı kargo/PSF/stopaj
      // yok → netVat 0, netProfit 0. (Eskiden iade fold edilmiyordu → 50.)
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.settledNetProfit?.toFixed(2)).toBe('0.00');
    });

    it('qty=2 line, ONE unit returned — trio amounts are per-unit (row.debt/commissionAmount); return legs use row values directly (NOT × quantity)', async () => {
      // PER-UNIT semantics pin (feeds #299 item-level attribution design):
      // research §3.2 — Trendyol emits one Return row per returned UNIT, so
      // row.debt and row.commissionAmount are that unit's figures and the
      // handler books exactly ONE unit's cost snapshot. None of the legs
      // may scale with OrderItem.quantity.
      //
      // Fixture (qty=2): saleGross=240, saleVat=40; estimatedCommissionGross=24;
      // costSnapshot=48/unit. Payment cycle settled 100.
      const { storeId, orderId } = await buildOrderWithItem({
        withCostAndSale: true,
        quantity: 2,
      });
      const row = makeSettlementRow({ transactionType: 'İade', debt: 120, credit: 0 });

      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result.applied).toBe(true);
      });

      const fees = await prisma.orderFee.findMany({ where: { orderId } });
      const byType = new Map(fees.map((f) => [f.feeType, f]));

      // GROSS: row.debt=120, row.commissionAmount=12, one unit's cost snapshot=48.
      // None of these scale by OrderItem.quantity (per-unit semantics).
      expect(byType.get('REFUND_DEDUCTION')?.amountGross.toFixed(2)).toBe('120.00');
      expect(byType.get('REFUND_DEDUCTION')?.vatRate.toFixed(2)).toBe('20.00');
      expect(byType.get('COMMISSION_REFUND')?.amountGross.toFixed(2)).toBe('12.00');
      // ONE unit's cost snapshot handed back — 48.00, never 96.00.
      expect(byType.get('COST_RETURN')?.amountGross.toFixed(2)).toBe('48.00');
      expect(byType.get('COST_RETURN')?.vatRate.toFixed(2)).toBe('20.00');

      // İade-kâra-yansıtma (2026-06): recompute iade bacaklarını fold eder.
      // qty=2 fixture (saleGross=240/cost=96/comm=24), 1 birim iade →
      // sale 240-120=120, cost 96-48=48, comm 24-12=12; netVat 20-8-2=10;
      // netProfit 120-48-12-10 = 50 (yarısı iade → yarı kâr; eskiden 100).
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.settledNetProfit?.toFixed(2)).toBe('50.00');
    });

    it('skips the commission credit (loudly) when the row carries no commissionAmount', async () => {
      const { storeId, orderId } = await buildOrderWithItem({ withCostAndSale: true });
      const row = makeSettlementRow({
        transactionType: 'İade',
        debt: 120,
        credit: 0,
        commissionAmount: null,
      });

      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result.applied).toBe(true);
      });

      const fees = await prisma.orderFee.findMany({ where: { orderId } });
      expect(fees.map((f) => f.feeType).sort()).toEqual(['COST_RETURN', 'REFUND_DEDUCTION']);
    });

    it('skips the cost reversal (loudly) when the item has no cost snapshot yet', async () => {
      const { storeId, orderId } = await buildOrderWithItem(); // snapshot'sız fixture
      const row = makeSettlementRow({ transactionType: 'İade', debt: 120, credit: 0 });

      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result.applied).toBe(true);
      });

      const fees = await prisma.orderFee.findMany({ where: { orderId } });
      expect(fees.map((f) => f.feeType).sort()).toEqual(['COMMISSION_REFUND', 'REFUND_DEDUCTION']);
      // No sale aggregate on this fixture → recompute skipped, no write.
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.settledNetProfit).toBeNull();
    });

    it('is idempotent — re-running on same row duplicates none of the trio', async () => {
      const { storeId, orderId } = await buildOrderWithItem({ withCostAndSale: true });
      const row = makeSettlementRow({ transactionType: 'İade', debt: 120, credit: 0 });

      await prisma.$transaction(async (tx) => {
        await handleReturn(storeId, row, tx);
      });
      // Second call — same Trendyol id, should detect existing externalRef.
      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result.applied).toBe(false);
      });

      const fees = await prisma.orderFee.findMany({ where: { orderId } });
      expect(fees).toHaveLength(3);
    });

    it('matches via the OrderClaim bridge when shipmentPackageId is the RETURN parcel id (live finding 6/6)', async () => {
      const { storeId, orderId } = await buildOrderWithItem({ withCostAndSale: true });
      // Claims sync stamped the return-parcel id on the claim — since #298
      // in the indexed orderShipmentPackageId column. externalRef is a
      // DECOY on purpose: audit-only, and if the bridge ever regressed to
      // the old JSONB path filter it would match nothing → applied=false.
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      await prisma.orderClaim.create({
        data: {
          organizationId: order.organizationId,
          storeId,
          orderId,
          trendyolClaimId: randomUUID(),
          claimDate: new Date(),
          resolved: false,
          orderShipmentPackageId: '999111222',
          externalRef: { orderShipmentPackageId: 'stale-audit-decoy' },
        },
      });

      const row = makeSettlementRow({
        transactionType: 'İade',
        debt: 120,
        credit: 0,
        shipmentPackageId: 999_111_222, // return parcel — NOT the outbound package
        orderNumber: null, // force the bridge path, no fallback available
      });

      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result.applied).toBe(true);
      });
      expect(await prisma.orderFee.count({ where: { orderId } })).toBe(3);
    });

    it('falls back to orderNumber + barcode single-candidate when no claim bridge exists', async () => {
      const { storeId, orderId } = await buildOrderWithItem({ withCostAndSale: true });
      const row = makeSettlementRow({
        transactionType: 'İade',
        debt: 120,
        credit: 0,
        shipmentPackageId: 777_555_333, // unknown return parcel, no claim synced yet
        // orderNumber default '11101228439' == fixture's platformOrderNumber
      });

      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result.applied).toBe(true);
      });
      expect(await prisma.orderFee.count({ where: { orderId } })).toBe(3);
    });

    it('SELF-HEAL: a cost snapshot entered after the first poll backfills COST_RETURN on re-poll', async () => {
      const { storeId, orderId, itemId } = await buildOrderWithItem(); // snapshot'sız
      const row = makeSettlementRow({ transactionType: 'İade', debt: 120, credit: 0 });

      await prisma.$transaction(async (tx) => {
        const r1 = await handleReturn(storeId, row, tx);
        expect(r1.applied).toBe(true);
      });
      expect(await prisma.orderFee.count({ where: { orderId } })).toBe(2); // COST_RETURN eksik

      // GROSS CONVENTION: unitCostSnapshotGross + unitCostSnapshotVatRate (net kolonlar kaldırıldı).
      await prisma.orderItem.update({
        where: { id: itemId },
        data: {
          unitCostSnapshotGross: new Decimal('48.00'), // 40 net + 8 VAT = 48 gross
          unitCostSnapshotVatRate: new Decimal('20.00'),
        },
      });

      // 6h re-poll: aynı satır — eksik bacak tamamlanır.
      await prisma.$transaction(async (tx) => {
        const r2 = await handleReturn(storeId, row, tx);
        expect(r2.applied).toBe(true);
      });
      const fees = await prisma.orderFee.findMany({ where: { orderId } });
      expect(fees.map((f) => f.feeType).sort()).toEqual([
        'COMMISSION_REFUND',
        'COST_RETURN',
        'REFUND_DEDUCTION',
      ]);
    });

    it('EARLY RETURN: skips the settled-profit refresh when the payment cycle has not run yet', async () => {
      const { storeId, orderId, itemId } = await buildOrderWithItem();
      // Cost + sale aggregate present, but NO settled figure (cycle pending).
      // GROSS CONVENTION: saleGross/saleVat (not saleSubtotalNet/saleVatTotal).
      await prisma.order.update({
        where: { id: orderId },
        data: { saleGross: new Decimal('120.00'), saleVat: new Decimal('20.00') },
      });
      await prisma.orderItem.update({
        where: { id: itemId },
        data: {
          unitCostSnapshotGross: new Decimal('48.00'), // 40 net + 8 VAT = 48 gross
          unitCostSnapshotVatRate: new Decimal('20.00'),
        },
      });
      const row = makeSettlementRow({ transactionType: 'İade', debt: 120, credit: 0 });

      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result.applied).toBe(true);
      });

      // Fees landed, but no premature settled figure — the upcoming
      // payment cycle will compute it with confirmed ESTIMATE fees.
      expect(await prisma.orderFee.count({ where: { orderId } })).toBe(3);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.settledNetProfit).toBeNull();
    });

    it('#299: links all three trio legs to the same claim item when the claim is synced', async () => {
      const { storeId, orderId, itemId } = await buildOrderWithItem({ withCostAndSale: true });
      const { claimItemIds } = await createClaimWithUnits({
        storeId,
        orderId,
        orderItemId: itemId,
        units: 1,
      });
      const row = makeSettlementRow({ transactionType: 'İade', debt: 120, credit: 0 });

      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result.applied).toBe(true);
      });

      const fees = await prisma.orderFee.findMany({ where: { orderId } });
      expect(fees).toHaveLength(3);
      // Every leg points at the SAME unit — the trio is one return event.
      expect(fees.map((f) => f.orderClaimItemId)).toEqual([
        claimItemIds[0],
        claimItemIds[0],
        claimItemIds[0],
      ]);
    });

    it('#299: two Return rows on a qty=2 line land on two DIFFERENT claim units (greedy)', async () => {
      const { storeId, orderId, itemId } = await buildOrderWithItem({
        withCostAndSale: true,
        quantity: 2,
      });
      const { claimItemIds } = await createClaimWithUnits({
        storeId,
        orderId,
        orderItemId: itemId,
        units: 2,
      });
      const rowUnit1 = makeSettlementRow({ transactionType: 'İade', debt: 120, credit: 0 });
      const rowUnit2 = makeSettlementRow({
        id: '725041341', // ikinci birimin KENDİ settlement satırı (farklı Trendyol id)
        transactionType: 'İade',
        debt: 120,
        credit: 0,
      });

      await prisma.$transaction(async (tx) => {
        await handleReturn(storeId, rowUnit1, tx);
      });
      await prisma.$transaction(async (tx) => {
        await handleReturn(storeId, rowUnit2, tx);
      });

      const fees = await prisma.orderFee.findMany({ where: { orderId } });
      expect(fees).toHaveLength(6);
      const unit1Fees = fees.filter((f) => f.trendyolTransactionId === rowUnit1.id);
      const unit2Fees = fees.filter((f) => f.trendyolTransactionId === '725041341');
      // Each trio is internally consistent...
      expect(new Set(unit1Fees.map((f) => f.orderClaimItemId)).size).toBe(1);
      expect(new Set(unit2Fees.map((f) => f.orderClaimItemId)).size).toBe(1);
      // ...and the two trios claimed two DIFFERENT units, covering both.
      const claimed = new Set([unit1Fees[0]?.orderClaimItemId, unit2Fees[0]?.orderClaimItemId]);
      expect(claimed).toEqual(new Set(claimItemIds));
    });

    it('#299 BACKFILL: trio written before the claim sync gets linked on the next re-poll', async () => {
      const { storeId, orderId, itemId } = await buildOrderWithItem({ withCostAndSale: true });
      const row = makeSettlementRow({ transactionType: 'İade', debt: 120, credit: 0 });

      // Poll 1 — settlements cron fires first (:30), claim not synced yet.
      await prisma.$transaction(async (tx) => {
        const r1 = await handleReturn(storeId, row, tx);
        expect(r1.applied).toBe(true);
      });
      const beforeLinks = await prisma.orderFee.findMany({ where: { orderId } });
      expect(beforeLinks.map((f) => f.orderClaimItemId)).toEqual([null, null, null]);

      // Claims cron lands 15 minutes later (:45).
      const { claimItemIds } = await createClaimWithUnits({
        storeId,
        orderId,
        orderItemId: itemId,
        units: 1,
      });

      // Poll 2 — every leg already exists (idempotent no-op), but the link
      // backfill must still run.
      await prisma.$transaction(async (tx) => {
        const r2 = await handleReturn(storeId, row, tx);
        expect(r2.applied).toBe(false); // hiçbir bacak yazılmadı
      });

      const fees = await prisma.orderFee.findMany({ where: { orderId } });
      expect(fees).toHaveLength(3); // backfill çoğaltmaz
      expect(fees.map((f) => f.orderClaimItemId)).toEqual([
        claimItemIds[0],
        claimItemIds[0],
        claimItemIds[0],
      ]);
    });

    it("#299 INHERIT: a late COST_RETURN leg reuses the trio's unit instead of grabbing a free one", async () => {
      const { storeId, orderId, itemId } = await buildOrderWithItem(); // snapshot'sız
      // Sale aggregate yok → recompute zaten atlanır; bağ davranışı izole kalır.
      const { claimItemIds } = await createClaimWithUnits({
        storeId,
        orderId,
        orderItemId: itemId,
        units: 2, // boşta İKİ birim — yanlış implementasyon ikinciye kayar
      });
      const row = makeSettlementRow({ transactionType: 'İade', debt: 120, credit: 0 });

      // Poll 1 — cost snapshot yok: 2 bacak yazılır, birim-1'e bağlanır.
      await prisma.$transaction(async (tx) => {
        await handleReturn(storeId, row, tx);
      });
      const firstLegs = await prisma.orderFee.findMany({ where: { orderId } });
      expect(firstLegs).toHaveLength(2);
      const trioUnit = firstLegs[0]?.orderClaimItemId;
      expect(trioUnit).not.toBeNull();
      expect(new Set(firstLegs.map((f) => f.orderClaimItemId)).size).toBe(1);

      // Maliyet snapshot'ı sonradan dolar (variant-resolution tick'inin geç
      // bağlaması — kâr-dışı OLMAYAN sipariş; spec 2026-06-12 sonrası tek geç yol).
      // GROSS CONVENTION: unitCostSnapshotGross + unitCostSnapshotVatRate.
      await prisma.orderItem.update({
        where: { id: itemId },
        data: {
          unitCostSnapshotGross: new Decimal('48.00'), // 40 net + 8 VAT = 48 gross
          unitCostSnapshotVatRate: new Decimal('20.00'),
        },
      });

      // Poll 2 — eksik COST_RETURN yazılır: aynı birimde KALMALI.
      await prisma.$transaction(async (tx) => {
        await handleReturn(storeId, row, tx);
      });
      const fees = await prisma.orderFee.findMany({ where: { orderId } });
      expect(fees).toHaveLength(3);
      expect(new Set(fees.map((f) => f.orderClaimItemId))).toEqual(new Set([trioUnit]));
      expect(claimItemIds).toContain(trioUnit);
    });

    it('skips with order_not_found when nothing matches (unknown parcel + unknown orderNumber)', async () => {
      const { storeId } = await buildOrderWithItem();
      const row = makeSettlementRow({
        transactionType: 'İade',
        debt: 120,
        shipmentPackageId: 888888,
        orderNumber: 'NO-SUCH-ORDER',
      });

      await prisma.$transaction(async (tx) => {
        const result = await handleReturn(storeId, row, tx);
        expect(result).toEqual({ applied: false, skipReason: 'order_not_found' });
      });
    });
  });
});
