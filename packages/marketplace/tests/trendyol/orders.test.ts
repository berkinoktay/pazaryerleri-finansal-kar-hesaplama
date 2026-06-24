// Regression guard for the Trendyol order mapper.
//
// The single most load-bearing invariant this file pins down is the
// `orderDate` normalisation: Trendyol stamps the field as Istanbul
// wall-clock-as-UTC (~3h ahead of the true instant), so a raw
// `new Date(orderDate)` corrupts every downstream business-day / hour
// computation (Live Performance chart, KPI bucketing, "today" filters,
// daily reset). The mapper must subtract the zone offset; if that call
// regresses, this suite fails loudly.
//
// Other assertions guard related contracts the mapper carries today:
// per-line KDV split, multi-rate package aggregation, sparse-line
// resilience, status mapping case-insensitivity, and the delivery-date
// derivation from packageHistories. Together they fence the boundaries
// the live data path depends on.

import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import { getBusinessDate, getBusinessHour } from '@pazarsync/utils';
import { syncLog } from '@pazarsync/sync-core';

import {
  computeDeliveredOnTime,
  mapLine,
  mapTrendyolOrdersResponse,
  mapTrendyolShipmentPackage,
  mapTrendyolStatusToEnum,
} from '../../src/trendyol/orders';
import type {
  MappedOrder,
  MappedOrderLine,
  PromotionDisplay,
  TrendyolOrderLine,
} from '../../src/trendyol/types';
import { buildLine, buildPackage } from '../helpers/order-builders';
import { PAYLOAD_11313045474, PAYLOAD_11323825496 } from '../fixtures/trendyol-gross-payloads';

/**
 * Efektif komisyon — Trendyol/panel'in GERÇEKTE aldığı tutar. commissionGross
 * LİSTE üzerinden brüt komisyon (#332); satıcı-indirim payının komisyonu
 * (refundedCommissionGross) iade edilir. Net = gross − refunded = effectiveSale ×
 * rate. İş anlamı taşıyan değer budur; testler ham commissionGross yerine BUNU
 * panele kilitler. İki kolon ayrı 2-ondalığa yuvarlandığından (Decimal(12,2)),
 * bazı satırlarda fark tek-yuvarlanmış effectiveSale×rate'ten bir kuruş kayabilir
 * — bu üretimde de saklanan davranıştır, fixture'lar gerçek değeri pinler.
 */
function effectiveCommission(line: MappedOrderLine): string {
  return new Decimal(line.commissionGross)
    .sub(new Decimal(line.refundedCommissionGross))
    .toFixed(2);
}

// ─── TrendyolDiscountDetail type (Task 7) ──────────────────────────────

describe('TrendyolDiscountDetail type', () => {
  it('parses a line with discountDetails array', () => {
    const line: TrendyolOrderLine = {
      lineId: 1,
      barcode: 'X',
      quantity: 3,
      lineUnitPrice: 269.66,
      lineGrossAmount: 285,
      lineSellerDiscount: 16,
      vatRate: 20,
      commission: 9.6,
      discountDetails: [
        { lineItemPrice: 268.99, lineItemSellerDiscount: 16.01 },
        { lineItemPrice: 269, lineItemSellerDiscount: 16 },
        { lineItemPrice: 269, lineItemSellerDiscount: 16 },
      ],
    };
    expect(line.discountDetails).toHaveLength(3);
    expect(line.discountDetails?.[0]?.lineItemPrice).toBe(268.99);
  });
});

// ─── MappedOrder GROSS shape (Task 8 — type-level) ─────────────────────

describe('MappedOrder GROSS shape', () => {
  it('exposes gross aggregate + promotionDisplays', () => {
    const sample = {} as MappedOrder;
    // Tip-seviyesi: aşağıdaki alanlar var olmalı (derleme hatası verirse FAIL).
    void (sample.saleGross satisfies string);
    void (sample.saleVat satisfies string);
    void (sample.listGross satisfies string);
    void (sample.sellerDiscountGross satisfies string);
    void (sample.promotionDisplays satisfies PromotionDisplay[] | null);
    void (sample.lines?.[0]?.lineSaleGross satisfies string | undefined);
    void (sample.lines?.[0]?.commissionGross satisfies string | undefined);
    expect(true).toBe(true);
  });
});

// ─── orderDate normalisation (the central invariant) ───────────────────

describe('mapTrendyolShipmentPackage — orderDate normalisation', () => {
  it('subtracts the Istanbul zone offset from the Trendyol wall-clock-as-UTC stamp', () => {
    // Trendyol stamps "2026-06-08 14:00 Istanbul" as if it were UTC.
    const trendyolStamp = Date.UTC(2026, 5, 8, 14, 0, 0);

    const mapped = mapTrendyolShipmentPackage(buildPackage({ orderDate: trendyolStamp }));

    // True instant is 11:00 UTC (Istanbul = GMT+3, no DST since 2016).
    expect(mapped.orderDate.toISOString()).toBe('2026-06-08T11:00:00.000Z');
  });

  it('preserves the Trendyol-stamped business hour (without normalisation it would read +3h ahead)', () => {
    // Trendyol stamps 14:00 Istanbul wall-clock. After normalisation the
    // business-zone hour must read 14, not 17 — the latter is the bug.
    const trendyolStamp = Date.UTC(2026, 5, 8, 14, 0, 0);

    const mapped = mapTrendyolShipmentPackage(buildPackage({ orderDate: trendyolStamp }));

    expect(getBusinessHour(mapped.orderDate)).toBe(14);
  });

  it('keeps the business date stable for orders stamped near midnight Istanbul', () => {
    // Trendyol stamp: 2026-06-08 23:30 Istanbul wall-clock-as-UTC.
    const trendyolStamp = Date.UTC(2026, 5, 8, 23, 30, 0);

    const mapped = mapTrendyolShipmentPackage(buildPackage({ orderDate: trendyolStamp }));

    // True instant 20:30 UTC → Istanbul 23:30 → business date 2026-06-08.
    expect(getBusinessDate(mapped.orderDate)).toBe('2026-06-08');
  });

  it('does NOT normalise lastModifiedDate (true UTC per Trendyol docs)', () => {
    const epoch = Date.UTC(2026, 5, 8, 14, 0, 0);

    const mapped = mapTrendyolShipmentPackage(
      buildPackage({ lastModifiedDate: epoch, orderDate: epoch }),
    );

    expect(mapped.lastModifiedDate.toISOString()).toBe('2026-06-08T14:00:00.000Z');
  });

  it('does NOT normalise agreedDeliveryDate (raw epoch passthrough, GMT)', () => {
    const epoch = Date.UTC(2026, 5, 10, 10, 0, 0);

    const mapped = mapTrendyolShipmentPackage(buildPackage({ agreedDeliveryDate: epoch }));

    expect(mapped.agreedDeliveryDate?.toISOString()).toBe('2026-06-10T10:00:00.000Z');
  });

  it('returns null for agreedDeliveryDate when Trendyol omits it', () => {
    const mapped = mapTrendyolShipmentPackage(buildPackage({ agreedDeliveryDate: undefined }));

    expect(mapped.agreedDeliveryDate).toBeNull();
  });
});

// ─── actualDeliveryDate derivation ─────────────────────────────────────

describe('mapTrendyolShipmentPackage — actualDeliveryDate derivation', () => {
  it("uses the 'Delivered' packageHistory createdDate without normalisation", () => {
    // packageHistories.createdDate is GMT (true UTC) per Trendyol docs.
    const deliveredAt = Date.UTC(2026, 5, 11, 9, 30, 0);

    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        packageHistories: [
          { status: 'Created', createdDate: Date.UTC(2026, 5, 8, 14, 0, 0) },
          { status: 'Shipped', createdDate: Date.UTC(2026, 5, 10, 10, 0, 0) },
          { status: 'Delivered', createdDate: deliveredAt },
        ],
      }),
    );

    expect(mapped.actualDeliveryDate?.toISOString()).toBe('2026-06-11T09:30:00.000Z');
  });

  it('returns null when packageHistories has no Delivered event', () => {
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        packageHistories: [
          { status: 'Created', createdDate: Date.UTC(2026, 5, 8, 14, 0, 0) },
          { status: 'Shipped', createdDate: Date.UTC(2026, 5, 10, 10, 0, 0) },
        ],
      }),
    );

    expect(mapped.actualDeliveryDate).toBeNull();
  });

  it('returns null when packageHistories is undefined', () => {
    const mapped = mapTrendyolShipmentPackage(buildPackage({ packageHistories: undefined }));

    expect(mapped.actualDeliveryDate).toBeNull();
  });

  it("derives actualShipDate from the 'Shipped' packageHistory createdDate (raw GMT)", () => {
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        packageHistories: [
          { status: 'Created', createdDate: Date.UTC(2026, 5, 8, 14, 0, 0) },
          { status: 'Shipped', createdDate: Date.UTC(2026, 5, 10, 10, 0, 0) },
          { status: 'Delivered', createdDate: Date.UTC(2026, 5, 11, 9, 30, 0) },
        ],
      }),
    );

    expect(mapped.actualShipDate?.toISOString()).toBe('2026-06-10T10:00:00.000Z');
  });

  it('returns null actualShipDate when packageHistories has no Shipped event', () => {
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        packageHistories: [{ status: 'Created', createdDate: Date.UTC(2026, 5, 8, 14, 0, 0) }],
      }),
    );

    expect(mapped.actualShipDate).toBeNull();
  });

  it("uses the FIRST 'Shipped' event when there are multiple (ship → UnDelivered → re-ship)", () => {
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        packageHistories: [
          { status: 'Created', createdDate: Date.UTC(2026, 5, 8, 14, 0, 0) },
          { status: 'Shipped', createdDate: Date.UTC(2026, 5, 10, 10, 0, 0) },
          { status: 'UnDelivered', createdDate: Date.UTC(2026, 5, 11, 9, 0, 0) },
          { status: 'Shipped', createdDate: Date.UTC(2026, 5, 12, 8, 0, 0) },
        ],
      }),
    );

    // İlk transport-handoff anı aynı-gün-sevk kriterinin tabanı — re-ship onu geç yapmaz.
    expect(mapped.actualShipDate?.toISOString()).toBe('2026-06-10T10:00:00.000Z');
  });
});

// ─── Per-line KDV split ────────────────────────────────────────────────

describe('mapTrendyolShipmentPackage — fast-delivery type + estimated window capture', () => {
  it('captures fastDeliveryType verbatim (prod sends "FastDelivery")', () => {
    const mapped = mapTrendyolShipmentPackage(buildPackage({ fastDeliveryType: 'FastDelivery' }));

    expect(mapped.fastDeliveryType).toBe('FastDelivery');
  });

  it('normalises empty fastDeliveryType ("" — stage / non-fast) to null', () => {
    const mapped = mapTrendyolShipmentPackage(buildPackage({ fastDeliveryType: '' }));

    expect(mapped.fastDeliveryType).toBeNull();
  });

  it('returns null fastDeliveryType when Trendyol omits the field', () => {
    const mapped = mapTrendyolShipmentPackage(buildPackage({ fastDeliveryType: undefined }));

    expect(mapped.fastDeliveryType).toBeNull();
  });

  it('captures estimatedDelivery window as raw-epoch Dates (GMT passthrough)', () => {
    const start = Date.UTC(2026, 5, 12, 15, 57, 28);
    const end = Date.UTC(2026, 5, 13, 11, 38, 56);
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({ estimatedDeliveryStartDate: start, estimatedDeliveryEndDate: end }),
    );

    expect(mapped.estimatedDeliveryStartDate?.toISOString()).toBe('2026-06-12T15:57:28.000Z');
    expect(mapped.estimatedDeliveryEndDate?.toISOString()).toBe('2026-06-13T11:38:56.000Z');
  });

  it('returns null estimatedDelivery when Trendyol sends 0 (stage)', () => {
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({ estimatedDeliveryStartDate: 0, estimatedDeliveryEndDate: 0 }),
    );

    expect(mapped.estimatedDeliveryStartDate).toBeNull();
    expect(mapped.estimatedDeliveryEndDate).toBeNull();
  });
});

describe('mapLine — GROSS output', () => {
  it('single discounted line: list/sale/sellerDiscount/saleVatRate/commission', () => {
    const line = buildLine({
      quantity: 1,
      lineGrossAmount: 120,
      lineSellerDiscount: 20,
      vatRate: 20,
      commission: 10,
      discountDetails: [{ lineItemPrice: 100, lineItemSellerDiscount: 20 }],
    });
    const m = mapLine(line, { shipmentPackageId: 1 });

    expect(m.lineListGross).toBe('120.00');
    expect(m.lineSaleGross).toBe('100.00');
    expect(m.lineSellerDiscountGross).toBe('20.00');
    expect(m.saleVatRate).toBe('20');
    // commissionGross LİSTE üzerinden brüt (120 × 10% = 12.00); refunded = 20 × 10% = 2.00.
    // Panel/Trendyol gerçek değeri EFEKTİF komisyon = gross − refunded = 10.00 (= 100 × 10%).
    expect(m.commissionGross).toBe('12.00'); // 120 (liste) × 10%
    expect(m.refundedCommissionGross).toBe('2.00'); // 20 (indirim) × 10%
    expect(effectiveCommission(m)).toBe('10.00'); // panel = effectiveSale 100 × 10%
    expect(m.commissionVatRate).toBe('20');
  });

  it('no discountDetails: falls back to lineGrossAmount × qty, discount 0', () => {
    const line = buildLine({ quantity: 3, lineGrossAmount: 60, vatRate: 20, commission: 10 });
    const m = mapLine(line, { shipmentPackageId: 1 });

    expect(m.lineListGross).toBe('180.00');
    expect(m.lineSaleGross).toBe('180.00'); // no discount → sale == list
    expect(m.lineSellerDiscountGross).toBe('0.00');
    // İndirim yok → liste == satış → commissionGross 18.00, refunded 0, efektif 18.00.
    expect(m.commissionGross).toBe('18.00'); // 180 (liste) × 10%
    expect(effectiveCommission(m)).toBe('18.00'); // indirim yok → gross == efektif
  });

  it('no discountDetails with lineSellerDiscount: scalar × qty fallback', () => {
    const line = buildLine({
      quantity: 2,
      lineGrossAmount: 120,
      lineSellerDiscount: 12,
      vatRate: 20,
      commission: 10,
    });
    const m = mapLine(line, { shipmentPackageId: 1 });

    expect(m.lineListGross).toBe('240.00');
    expect(m.lineSellerDiscountGross).toBe('24.00'); // 12 × 2
    expect(m.lineSaleGross).toBe('216.00'); // 240 − 24
    expect(m.commissionGross).toBe('24.00'); // 240 (liste) × 10%
    expect(m.refundedCommissionGross).toBe('2.40'); // 24 (indirim) × 10%
    expect(effectiveCommission(m)).toBe('21.60'); // panel = effectiveSale 216 × 10%
  });

  it('qty>1 uneven discount via discountDetails (11313045474)', () => {
    const line = buildLine({
      quantity: 3,
      lineGrossAmount: 285,
      lineSellerDiscount: 16,
      vatRate: 20,
      commission: 9.6,
      discountDetails: [
        { lineItemPrice: 268.99, lineItemSellerDiscount: 16.01 },
        { lineItemPrice: 269, lineItemSellerDiscount: 16 },
        { lineItemPrice: 269, lineItemSellerDiscount: 16 },
      ],
    });
    const m = mapLine(line, { shipmentPackageId: 11313045474 });

    expect(m.lineSaleGross).toBe('806.99'); // Σ lineItemPrice
    expect(m.lineListGross).toBe('855.00'); // 285 × 3
    expect(m.lineSellerDiscountGross).toBe('48.01'); // Σ lineItemSellerDiscount (≠ 16×3)
    expect(m.commissionGross).toBe('82.08'); // 855 (liste) × 9.6%
    expect(m.refundedCommissionGross).toBe('4.61'); // 48.01 (indirim) × 9.6%
    expect(effectiveCommission(m)).toBe('77.47'); // panel = effectiveSale 806.99 × 9.6%
  });

  it('uses the commissionVatRate param verbatim on output (denetim A — DB-driven)', () => {
    const line = buildLine({ lineGrossAmount: 100, vatRate: 20, commission: 10 });
    const m = mapLine(line, { shipmentPackageId: 1 }, 18);
    expect(m.commissionVatRate).toBe('18');
  });

  it('falls back to the 20% default commissionVatRate when omitted', () => {
    const line = buildLine({ lineGrossAmount: 100, vatRate: 20, commission: 10 });
    expect(mapLine(line, { shipmentPackageId: 1 }).commissionVatRate).toBe('20');
  });

  it('estimates refunded commission on the seller-discount portion', () => {
    // discountDetails: list 1000, sale 900, sellerDiscount 100; commission %10.
    // commissionGross = 1000 (liste) × 10% = 100; refunded = 100 × 10% = 10;
    // efektif = 100 − 10 = 90 (= effectiveSale 900 × 10%, panel değeri).
    const line = buildLine({
      quantity: 1,
      lineGrossAmount: 1000,
      vatRate: 20,
      commission: 10,
      discountDetails: [{ lineItemPrice: 900, lineItemSellerDiscount: 100 }],
    });
    const m = mapLine(line, { shipmentPackageId: 1 });

    expect(m.lineSaleGross).toBe('900.00');
    expect(m.commissionGross).toBe('100.00'); // 1000 (liste) × 10%
    expect(m.refundedCommissionGross).toBe('10.00');
    expect(effectiveCommission(m)).toBe('90.00'); // panel = effectiveSale 900 × 10%
  });

  it('refunded commission is 0 when there is no seller discount', () => {
    const line = buildLine({ lineGrossAmount: 100, commission: 10, vatRate: 20 });
    const m = mapLine(line, { shipmentPackageId: 1 });
    expect(m.lineSellerDiscountGross).toBe('0.00');
    expect(m.refundedCommissionGross).toBe('0.00');
  });

  it('does NOT double-subtract the discount from commission (canlı sipariş 11328013993)', () => {
    // Gerçek sipariş 11328013993: liste 330, effectiveSale 313.50, satıcı indirim 16.50,
    // komisyon %19. DOĞRU efektif komisyon = effectiveSale 313.50 × 19% = 59.57 (rakip
    // + Trendyol gerçek; iki kolon yuvarlamasıyla 59.56).
    //
    // ESKİ HATA: commissionGross effectiveSale tabanlıydı (313.50 × 19% = 59.57), refunded
    // de indirimi düşüyordu (16.50 × 19% = 3.14) → efektif = 59.57 − 3.14 = 56.43; indirim
    // İKİ KEZ düşülüyordu (komisyon ~3 TL eksik). Bu test çift-düşmeyi kalıcı yasaklar:
    // taban LİSTE olmalı, indirim YALNIZ refunded'da düşülmeli.
    const line = buildLine({
      quantity: 1,
      lineGrossAmount: 330,
      vatRate: 20,
      commission: 19,
      discountDetails: [{ lineItemPrice: 313.5, lineItemSellerDiscount: 16.5 }],
    });
    const m = mapLine(line, { shipmentPackageId: 11328013993 });

    expect(m.lineListGross).toBe('330.00');
    expect(m.lineSaleGross).toBe('313.50');
    expect(m.commissionGross).toBe('62.70'); // 330 (LİSTE) × 19% — effectiveSale DEĞİL
    expect(m.refundedCommissionGross).toBe('3.14'); // 16.50 × 19% = 3.135 → 3.14
    // Efektif komisyon = 62.70 − 3.14 = 59.56 (panel ≈ 59.57); KESİNLİKLE 56.43 DEĞİL.
    expect(effectiveCommission(m)).toBe('59.56');
    expect(effectiveCommission(m)).not.toBe('56.43'); // çift-düşme regresyon kapısı
  });

  it('defaults commissionRate/commissionGross to 0 when Trendyol omits commission', () => {
    const line = buildLine({ commission: undefined });
    const m = mapLine(line, { shipmentPackageId: 1 });
    expect(m.commissionRate).toBe('0');
    expect(m.commissionGross).toBe('0.00');
  });
});

// ─── Package header from totals + saleVat + invariant ─────────────────

describe('mapTrendyolShipmentPackage — package totals + invariant', () => {
  it('order header from package totals directly', () => {
    const pkg = buildPackage({
      packageGrossAmount: 855,
      packageSellerDiscount: 48.01,
      packageTotalPrice: 806.99,
      lines: [
        buildLine({
          quantity: 3,
          lineGrossAmount: 285,
          vatRate: 20,
          commission: 9.6,
          discountDetails: [
            { lineItemPrice: 268.99, lineItemSellerDiscount: 16.01 },
            { lineItemPrice: 269, lineItemSellerDiscount: 16 },
            { lineItemPrice: 269, lineItemSellerDiscount: 16 },
          ],
        }),
      ],
    });
    const m = mapTrendyolShipmentPackage(pkg);

    expect(m.saleGross).toBe('806.99'); // = packageTotalPrice (no recompute)
    expect(m.listGross).toBe('855.00'); // = packageGrossAmount
    expect(m.sellerDiscountGross).toBe('48.01'); // = packageSellerDiscount
  });

  it('saleVat derived per-line from each lineSaleGross + its own rate (multi-VAT)', () => {
    // Line 1: sale 120 @ 20% → vat 20. Line 2: sale 110 @ 10% → vat 10. Σ = 30.
    const pkg = buildPackage({
      packageGrossAmount: 230,
      packageSellerDiscount: 0,
      packageTotalPrice: 230,
      lines: [
        buildLine({
          quantity: 1,
          lineGrossAmount: 120,
          vatRate: 20,
          discountDetails: [{ lineItemPrice: 120, lineItemSellerDiscount: 0 }],
        }),
        buildLine({
          quantity: 1,
          lineGrossAmount: 110,
          vatRate: 10,
          discountDetails: [{ lineItemPrice: 110, lineItemSellerDiscount: 0 }],
        }),
      ],
    });
    const m = mapTrendyolShipmentPackage(pkg);

    expect(m.saleGross).toBe('230.00');
    expect(m.saleVat).toBe('30.00');
  });

  it('warns when Σ line sale != package total (no silent drift)', () => {
    const warn = vi.spyOn(syncLog, 'warn').mockImplementation(() => undefined);
    const pkg = buildPackage({
      packageTotalPrice: 450,
      packageGrossAmount: 500,
      packageSellerDiscount: 50,
      lines: [
        buildLine({
          quantity: 1,
          lineGrossAmount: 100,
          vatRate: 20,
          discountDetails: [{ lineItemPrice: 89, lineItemSellerDiscount: 11 }],
        }),
      ],
    });
    mapTrendyolShipmentPackage(pkg);

    expect(warn).toHaveBeenCalledWith(
      'orders.package-invariant-mismatch',
      expect.objectContaining({ shipmentPackageId: pkg.shipmentPackageId }),
    );
    warn.mockRestore();
  });

  it('does NOT warn when Σ line sale == package total', () => {
    const warn = vi.spyOn(syncLog, 'warn').mockImplementation(() => undefined);
    const pkg = buildPackage({
      packageTotalPrice: 89,
      packageGrossAmount: 100,
      packageSellerDiscount: 11,
      lines: [
        buildLine({
          quantity: 1,
          lineGrossAmount: 100,
          vatRate: 20,
          discountDetails: [{ lineItemPrice: 89, lineItemSellerDiscount: 11 }],
        }),
      ],
    });
    mapTrendyolShipmentPackage(pkg);

    const invariantCalls = warn.mock.calls.filter(
      ([event]) => event === 'orders.package-invariant-mismatch',
    );
    expect(invariantCalls).toHaveLength(0);
    warn.mockRestore();
  });

  it('extracts promotionDisplays from the seller-discount total, null when none', () => {
    const withDiscount = mapTrendyolShipmentPackage(
      buildPackage({
        packageGrossAmount: 100,
        packageSellerDiscount: 11,
        packageTotalPrice: 89,
        lines: [
          buildLine({
            lineGrossAmount: 100,
            vatRate: 20,
            discountDetails: [{ lineItemPrice: 89, lineItemSellerDiscount: 11 }],
          }),
        ],
      }),
    );
    expect(withDiscount.promotionDisplays).toEqual([
      { displayName: 'Satıcı İndirimi', amountGross: '11.00' },
    ]);

    const noDiscount = mapTrendyolShipmentPackage(
      buildPackage({
        packageGrossAmount: 100,
        packageSellerDiscount: 0,
        packageTotalPrice: 100,
        lines: [
          buildLine({
            lineGrossAmount: 100,
            vatRate: 20,
            discountDetails: [{ lineItemPrice: 100, lineItemSellerDiscount: 0 }],
          }),
        ],
      }),
    );
    expect(noDiscount.promotionDisplays).toBeNull();
  });
});

// ─── GROSS fixture regression (real prod payloads, Task 10) ───────────
// Penny-lock: these assert the mapper output against Trendyol's package totals
// to the kuruş. The fixtures are real prod dumps — if a value below ever fails,
// the mapper is wrong, not the expected number.

describe('GROSS fixture regression (real prod payloads)', () => {
  it('11313045474: qty>1 uneven split matches package totals exactly', () => {
    const m = mapTrendyolShipmentPackage(PAYLOAD_11313045474);

    expect(m.saleGross).toBe('806.99');
    expect(m.listGross).toBe('855.00');
    expect(m.sellerDiscountGross).toBe('48.01');
    expect(m.lines[0]?.lineSaleGross).toBe('806.99');
    expect(m.lines[0]?.lineSellerDiscountGross).toBe('48.01');
    // commissionGross LİSTE üzerinden (855 × 9.6% = 82.08); panel/Trendyol gerçek
    // değeri EFEKTİF komisyon = 82.08 − 4.61 = 77.47 (= effectiveSale 806.99 × 9.6%).
    expect(m.lines[0]?.commissionGross).toBe('82.08'); // 855 (liste) × 9.6%
    expect(m.lines[0]?.refundedCommissionGross).toBe('4.61'); // 48.01 × 9.6%
    expect(effectiveCommission(m.lines[0]!)).toBe('77.47'); // panel
  });

  it('11323825496: 3-product multi-rate efektif komisyon panele kilitli', () => {
    const m = mapTrendyolShipmentPackage(PAYLOAD_11323825496);

    expect(m.saleGross).toBe('423.70');
    expect(m.listGross).toBe('446.00');
    expect(m.sellerDiscountGross).toBe('22.30');

    // İş anlamı taşıyan değer EFEKTİF komisyon (gross − refunded); ham commissionGross
    // artık LİSTE üzerinden brüt. Panel her satır için effectiveSale × rate:
    //   l0: 104.5 × 14.8% = 15.47   l1: 174.8 × 19% = 33.21   l2: 144.4 × 15.2% = 21.94*
    // *l2: iki kolon ayrı 2-ondalığa yuvarlandığından (23.10 − 1.16) = 21.94; tek-yuvarlanmış
    //  144.4×15.2% = 21.9488 → 21.95'ten bir kuruş kayar. Bu üretimde de saklanan davranıştır
    //  (commission_gross / refunded_commission_gross Decimal(12,2) kolonlar).
    expect(effectiveCommission(m.lines[0]!)).toBe('15.47');
    expect(effectiveCommission(m.lines[1]!)).toBe('33.21');
    expect(effectiveCommission(m.lines[2]!)).toBe('21.94');

    // LİSTE-tabanlı ham commissionGross (downstream net/KDV split için saklanan).
    expect(m.lines[0]?.commissionGross).toBe('16.28'); // 110 × 14.8%
    expect(m.lines[1]?.commissionGross).toBe('34.96'); // 184 × 19%
    expect(m.lines[2]?.commissionGross).toBe('23.10'); // 152 × 15.2%

    const totalEffective = [m.lines[0], m.lines[1], m.lines[2]].reduce(
      (sum, line) => sum.add(new Decimal(effectiveCommission(line!))),
      new Decimal(0),
    );
    expect(totalEffective.toFixed(2)).toBe('70.62');
  });
});

// ─── Sparse-line defensive fallback (PR-A regression hotfix) ──────────

describe('mapTrendyolShipmentPackage — sparse-line resilience', () => {
  it('does not throw on a line missing quantity / pricing / vat fields', () => {
    expect(() =>
      mapTrendyolShipmentPackage(
        buildPackage({
          lines: [
            // Mimic the sparse legacy/stage line the PR-A hotfix targets.
            {
              lineId: 99,
              barcode: 'SPARSE-1',
              quantity: undefined as unknown as number,
              lineUnitPrice: undefined as unknown as number,
              lineGrossAmount: undefined as unknown as number,
              vatRate: undefined as unknown as number,
            },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('falls back to zero values for a sparse line so the batch still maps', () => {
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        // Sparse line carries no pricing → realistic package total is 0.
        packageGrossAmount: 0,
        packageSellerDiscount: 0,
        packageTotalPrice: 0,
        lines: [
          {
            lineId: 99,
            barcode: 'SPARSE-1',
            quantity: undefined as unknown as number,
            lineUnitPrice: undefined as unknown as number,
            lineGrossAmount: undefined as unknown as number,
            vatRate: undefined as unknown as number,
          },
        ],
      }),
    );

    expect(mapped.lines[0]?.quantity).toBe(0);
    expect(mapped.lines[0]?.lineSaleGross).toBe('0.00');
    expect(mapped.lines[0]?.lineListGross).toBe('0.00');
    expect(mapped.lines[0]?.commissionGross).toBe('0.00');
    expect(mapped.saleGross).toBe('0.00');
  });
});

// ─── Status mapping (case-insensitive + fallback) ──────────────────────

describe('mapTrendyolStatusToEnum', () => {
  it.each([
    ['Created', 'PENDING'],
    ['Awaiting', 'PENDING'],
    ['Picking', 'PROCESSING'],
    ['Invoiced', 'PROCESSING'],
    // Split ghost — defense-in-depth CANCELLED (intake deletes via dematerialized).
    ['Unpacked', 'CANCELLED'],
    ['Verified', 'PROCESSING'],
    ['Shipped', 'SHIPPED'],
    ['UnDelivered', 'SHIPPED'],
    ['AtCollectionPoint', 'SHIPPED'],
    ['Delivered', 'DELIVERED'],
    ['Cancelled', 'CANCELLED'],
    ['Unsupplied', 'CANCELLED'],
    ['Returned', 'RETURNED'],
  ])('maps Trendyol status %s → %s', (input, expected) => {
    expect(mapTrendyolStatusToEnum(input)).toBe(expected);
  });

  it('is case-insensitive (webhook UPPERCASE form)', () => {
    expect(mapTrendyolStatusToEnum('DELIVERED')).toBe('DELIVERED');
    expect(mapTrendyolStatusToEnum('SHIPPED')).toBe('SHIPPED');
  });

  it('accepts both AtCollectionPoint and AT_COLLECTION_POINT spellings', () => {
    expect(mapTrendyolStatusToEnum('AtCollectionPoint')).toBe('SHIPPED');
    expect(mapTrendyolStatusToEnum('AT_COLLECTION_POINT')).toBe('SHIPPED');
  });

  it('returns null for unknown statuses (caller decides fallback)', () => {
    expect(mapTrendyolStatusToEnum('NewlyInventedStatus')).toBeNull();
  });
});

describe('mapTrendyolShipmentPackage — status fallback (sync path)', () => {
  it("falls back to 'PROCESSING' on an unknown Trendyol status", () => {
    const mapped = mapTrendyolShipmentPackage(buildPackage({ status: 'NewlyInventedStatus' }));
    expect(mapped.status).toBe('PROCESSING');
  });
});

// ─── Split-ghost dematerialization flag (research 2026-06-09) ──────────

describe('mapTrendyolShipmentPackage — dematerialized flag', () => {
  it('marks UnPacked packages as dematerialized (split ghost)', () => {
    const mapped = mapTrendyolShipmentPackage(buildPackage({ status: 'UnPacked' }));
    expect(mapped.dematerialized).toBe(true);
    // Defense-in-depth: if a ghost ever persists, it stays out of revenue.
    expect(mapped.status).toBe('CANCELLED');
  });

  it('is case-insensitive (webhook UPPERCASE form)', () => {
    const mapped = mapTrendyolShipmentPackage(buildPackage({ status: 'UNPACKED' }));
    expect(mapped.dematerialized).toBe(true);
  });

  it('stays false for every live status', () => {
    for (const status of ['Created', 'Picking', 'Shipped', 'Delivered', 'Cancelled', 'Returned']) {
      expect(mapTrendyolShipmentPackage(buildPackage({ status })).dematerialized).toBe(false);
    }
  });
});

// ─── PR-8 cargo enrichment (research 2026-06-09) ───────────────────────

describe('mapTrendyolShipmentPackage — cargo fields', () => {
  it('maps cargo fields verbatim when present', () => {
    const mapped = mapTrendyolShipmentPackage({
      ...buildPackage(),
      cargoProviderName: 'Trendyol Express Marketplace',
      cargoTrackingNumber: 7330000167510333,
      cargoDeci: 2.5,
      whoPays: 1,
      createdBy: 'split',
      originShipmentDate: Date.UTC(2026, 5, 8, 11, 0, 0),
    });

    expect(mapped.cargoProviderName).toBe('Trendyol Express Marketplace');
    // Identity, not money — raw String(), never toFixed.
    expect(mapped.cargoTrackingNumber).toBe('7330000167510333');
    expect(mapped.cargoDeci).toBe('2.5');
    expect(mapped.usesSellerCargoAgreement).toBe(true);
    expect(mapped.platformCreatedBy).toBe('split');
    // originShipmentDate is true UTC — RAW passthrough, no zone normalisation.
    expect(mapped.originShipmentDate?.toISOString()).toBe('2026-06-08T11:00:00.000Z');
  });

  it('defaults to null/false when Trendyol omits the fields (stage shape)', () => {
    const mapped = mapTrendyolShipmentPackage(buildPackage());

    expect(mapped.cargoProviderName).toBeNull();
    expect(mapped.cargoTrackingNumber).toBeNull();
    expect(mapped.cargoDeci).toBeNull();
    // whoPays absent == Trendyol cargo agreement (Berkin-confirmed semantics).
    expect(mapped.usesSellerCargoAgreement).toBe(false);
    expect(mapped.platformCreatedBy).toBeNull();
    expect(mapped.originShipmentDate).toBeNull();
  });

  it('whoPays values other than 1 do not flag a seller agreement', () => {
    const mapped = mapTrendyolShipmentPackage({ ...buildPackage(), whoPays: 0 });
    expect(mapped.usesSellerCargoAgreement).toBe(false);
  });

  it('carries the Trendyol line id onto each mapped line', () => {
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({ lines: [buildLine({ lineId: 10328256 })] }),
    );
    expect(mapped.lines[0]?.platformLineId).toBe('10328256');
  });
});

// ─── Full-page response wrapper ────────────────────────────────────────

describe('mapTrendyolOrdersResponse', () => {
  it('passes page meta through and maps every content entry', () => {
    const mapped = mapTrendyolOrdersResponse({
      totalElements: 42,
      totalPages: 3,
      page: 1,
      size: 20,
      content: [buildPackage({ status: 'Created' }), buildPackage({ status: 'Delivered' })],
    });

    expect(mapped.pageMeta).toEqual({
      totalElements: 42,
      totalPages: 3,
      page: 1,
      size: 20,
    });
    expect(mapped.batch).toHaveLength(2);
    expect(mapped.batch[0]?.status).toBe('PENDING');
    expect(mapped.batch[1]?.status).toBe('DELIVERED');
  });
});

describe('computeDeliveredOnTime', () => {
  const agreed = new Date('2026-05-20T00:00:00Z');

  it('returns true when delivered before the agreed date', () => {
    expect(computeDeliveredOnTime(agreed, new Date('2026-05-19T10:00:00Z'))).toBe(true);
  });

  it('returns true when delivered exactly on the agreed date (boundary = on time)', () => {
    expect(computeDeliveredOnTime(agreed, new Date('2026-05-20T00:00:00Z'))).toBe(true);
  });

  it('returns false when delivered after the agreed date', () => {
    expect(computeDeliveredOnTime(agreed, new Date('2026-05-22T10:00:00Z'))).toBe(false);
  });

  it('returns null when not yet delivered (actual null)', () => {
    expect(computeDeliveredOnTime(agreed, null)).toBeNull();
  });

  it('returns null when there is no agreed date', () => {
    expect(computeDeliveredOnTime(null, new Date('2026-05-19T10:00:00Z'))).toBeNull();
  });

  it('returns null when both dates are missing', () => {
    expect(computeDeliveredOnTime(null, null)).toBeNull();
  });
});

describe('mapTrendyolShipmentPackage — deliveredOnTime', () => {
  const AGREED_MS = Date.parse('2026-05-20T00:00:00Z');

  it('derives true when the Delivered event is on/before the agreed date', () => {
    const pkg = buildPackage({
      agreedDeliveryDate: AGREED_MS,
      packageHistories: [{ status: 'Delivered', createdDate: Date.parse('2026-05-19T10:00:00Z') }],
    });
    expect(mapTrendyolShipmentPackage(pkg).deliveredOnTime).toBe(true);
  });

  it('derives false when the Delivered event is after the agreed date', () => {
    const pkg = buildPackage({
      agreedDeliveryDate: AGREED_MS,
      packageHistories: [{ status: 'Delivered', createdDate: Date.parse('2026-05-22T10:00:00Z') }],
    });
    expect(mapTrendyolShipmentPackage(pkg).deliveredOnTime).toBe(false);
  });

  it('is null when the package has not been delivered', () => {
    const pkg = buildPackage({ agreedDeliveryDate: AGREED_MS, packageHistories: [] });
    expect(mapTrendyolShipmentPackage(pkg).deliveredOnTime).toBeNull();
  });
});
