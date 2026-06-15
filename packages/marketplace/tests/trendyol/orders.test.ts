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
import { describe, expect, it } from 'vitest';
import { getBusinessDate, getBusinessHour } from '@pazarsync/utils';

import {
  mapTrendyolOrdersResponse,
  mapTrendyolShipmentPackage,
  mapTrendyolStatusToEnum,
} from '../../src/trendyol/orders';
import type {
  MappedOrder,
  PromotionDisplay,
  TrendyolOrderLine,
  TrendyolPackageHistory,
  TrendyolShipmentPackage,
} from '../../src/trendyol/types';

// ─── Fixture builders ──────────────────────────────────────────────────

interface PackageOverrides {
  status?: string;
  orderDate?: number;
  lastModifiedDate?: number;
  agreedDeliveryDate?: number | undefined;
  estimatedDeliveryStartDate?: number | undefined;
  estimatedDeliveryEndDate?: number | undefined;
  lines?: TrendyolOrderLine[];
  packageHistories?: TrendyolPackageHistory[] | undefined;
  fastDelivery?: boolean;
  fastDeliveryType?: string | undefined;
  micro?: boolean;
}

function buildLine(overrides: Partial<TrendyolOrderLine> = {}): TrendyolOrderLine {
  return {
    lineId: 1,
    barcode: 'BARCODE-1',
    quantity: 1,
    lineUnitPrice: 120,
    lineGrossAmount: 120,
    vatRate: 20,
    commission: 10,
    ...overrides,
  };
}

function buildPackage(overrides: PackageOverrides = {}): TrendyolShipmentPackage {
  return {
    orderNumber: 'ORDER-NUMBER-1',
    shipmentPackageId: 1234567,
    status: overrides.status ?? 'Created',
    orderDate: overrides.orderDate ?? Date.UTC(2026, 5, 8, 14, 0, 0),
    lastModifiedDate: overrides.lastModifiedDate ?? Date.UTC(2026, 5, 8, 14, 0, 0),
    agreedDeliveryDate: overrides.agreedDeliveryDate,
    estimatedDeliveryStartDate: overrides.estimatedDeliveryStartDate,
    estimatedDeliveryEndDate: overrides.estimatedDeliveryEndDate,
    packageGrossAmount: 120,
    fastDelivery: overrides.fastDelivery ?? false,
    fastDeliveryType: overrides.fastDeliveryType,
    micro: overrides.micro ?? false,
    lines: overrides.lines ?? [buildLine()],
    packageHistories: overrides.packageHistories,
  };
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
    void (sample.lines[0]?.lineSaleGross satisfies string | undefined);
    void (sample.lines[0]?.commissionGross satisfies string | undefined);
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

describe('mapTrendyolShipmentPackage — per-line KDV split', () => {
  it('splits a 20% VAT line correctly: 120 gross → 100 net + 20 VAT', () => {
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        lines: [buildLine({ lineUnitPrice: 120, lineGrossAmount: 120, vatRate: 20 })],
      }),
    );

    expect(mapped.lines[0]?.unitPriceNet).toBe('100');
    expect(mapped.lines[0]?.unitVatAmount).toBe('20');
    expect(mapped.lines[0]?.unitVatRate).toBe('20');
  });

  it('splits a 10% VAT line correctly: 110 gross → 100 net + 10 VAT', () => {
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        lines: [buildLine({ lineUnitPrice: 110, lineGrossAmount: 110, vatRate: 10 })],
      }),
    );

    expect(mapped.lines[0]?.unitPriceNet).toBe('100');
    expect(mapped.lines[0]?.unitVatAmount).toBe('10');
  });

  it('computes gross commission with the 20% commission-VAT split', () => {
    // lineGrossAmount 100, commission 10% → grossCommissionGross 10
    // grossCommissionAmountNet = 10 / 1.20 = 8.33 (toDecimalPlaces 2)
    // grossCommissionVatAmount = 10 - 8.33 = 1.67
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        lines: [
          buildLine({ lineUnitPrice: 100, lineGrossAmount: 100, vatRate: 20, commission: 10 }),
        ],
      }),
    );

    expect(mapped.lines[0]?.grossCommissionAmountNet).toBe('8.33');
    expect(mapped.lines[0]?.grossCommissionVatAmount).toBe('1.67');
    expect(mapped.lines[0]?.commissionRate).toBe('10');
  });

  it('uses the commissionVatRate param for the KDV split (denetim A — DB-driven)', () => {
    // grossCommissionGross 10; rate %18 → divisor 1.18 → net 10/1.18 = 8.47,
    // vat 10 - 8.47 = 1.53. Differs from the 20% default (8.33 / 1.67).
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        lines: [
          buildLine({ lineUnitPrice: 100, lineGrossAmount: 100, vatRate: 20, commission: 10 }),
        ],
      }),
      18,
    );

    expect(mapped.lines[0]?.grossCommissionAmountNet).toBe('8.47');
    expect(mapped.lines[0]?.grossCommissionVatAmount).toBe('1.53');
  });

  it('falls back to the 20% default when commissionVatRate is omitted', () => {
    const lines = [
      buildLine({ lineUnitPrice: 100, lineGrossAmount: 100, vatRate: 20, commission: 10 }),
    ];
    const omitted = mapTrendyolShipmentPackage(buildPackage({ lines }));
    const explicit20 = mapTrendyolShipmentPackage(buildPackage({ lines }), 20);

    expect(omitted.lines[0]?.grossCommissionAmountNet).toBe('8.33');
    expect(omitted.lines[0]?.grossCommissionAmountNet).toBe(
      explicit20.lines[0]?.grossCommissionAmountNet,
    );
  });

  it('splits sellerDiscount with the per-line vatRate', () => {
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        lines: [
          buildLine({
            lineUnitPrice: 120,
            lineGrossAmount: 120,
            vatRate: 20,
            lineSellerDiscount: 12,
          }),
        ],
      }),
    );

    expect(mapped.lines[0]?.sellerDiscountNet).toBe('10');
    expect(mapped.lines[0]?.sellerDiscountVatAmount).toBe('2');
  });

  it('estimates refunded commission on the seller-discount portion (komisyon net satış üzerinden)', () => {
    // lineGrossAmount 1000, lineSellerDiscount 100, commission %10 → effectiveSale 900.
    // gross commission gross = 1000×%10 = 100 → net 100/1.2 = 83.33
    // refunded commission gross = 100×%10 = 10 → net 10/1.2 = 8.33
    // effective net = 83.33 − 8.33 = 75.00 = (900×%10)/1.2 = net-satış tabanlı (2026-06-14).
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        lines: [
          buildLine({
            lineUnitPrice: 900,
            lineGrossAmount: 1000,
            lineSellerDiscount: 100,
            vatRate: 20,
            commission: 10,
          }),
        ],
      }),
    );

    const line = mapped.lines[0];
    expect(line?.grossCommissionAmountNet).toBe('83.33'); // SALE-side (liste) — değişmedi
    expect(line?.refundedCommissionAmountNet).toBe('8.33'); // satıcı-indirim payı iadesi
    expect(line?.refundedCommissionVatAmount).toBe('1.67');
    // effective = gross − refunded = net-satış tabanlı komisyon
    const effectiveNet = new Decimal(line?.grossCommissionAmountNet ?? '0').sub(
      new Decimal(line?.refundedCommissionAmountNet ?? '0'),
    );
    expect(effectiveNet.toString()).toBe('75');
  });

  it('refunded commission is 0 when there is no seller discount', () => {
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        lines: [
          buildLine({ lineUnitPrice: 100, lineGrossAmount: 100, commission: 10, vatRate: 20 }),
        ],
      }),
    );
    expect(mapped.lines[0]?.refundedCommissionAmountNet).toBe('0');
    expect(mapped.lines[0]?.refundedCommissionVatAmount).toBe('0');
  });

  it('defaults commissionRate to "0" when Trendyol omits the field', () => {
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        lines: [buildLine({ commission: undefined })],
      }),
    );

    expect(mapped.lines[0]?.commissionRate).toBe('0');
    expect(mapped.lines[0]?.grossCommissionAmountNet).toBe('0');
    expect(mapped.lines[0]?.grossCommissionVatAmount).toBe('0');
  });
});

// ─── Package aggregate (multi-VAT-aware) ──────────────────────────────

describe('mapTrendyolShipmentPackage — saleSubtotalNet aggregate', () => {
  it('sums net subtotal across multiple lines at the same VAT rate', () => {
    // lineGrossAmount BİRİM başınadır (Trendyol doc) — 120/unit × 2 adet, 60/unit × 3 adet.
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        lines: [
          // 2 × (120 → 100 net) = 200
          buildLine({ quantity: 2, lineUnitPrice: 120, lineGrossAmount: 120, vatRate: 20 }),
          // 3 × (60 → 50 net) = 150
          buildLine({ quantity: 3, lineUnitPrice: 60, lineGrossAmount: 60, vatRate: 20 }),
        ],
      }),
    );

    expect(mapped.saleSubtotalNet).toBe('350.00');
    expect(mapped.saleVatTotal).toBe('70.00');
  });

  // ─── quantity > 1: lineGrossAmount/lineSellerDiscount BİRİM başına ───────
  // Regression guard for the live-validated bug (#455451555, 2026-06-14): a qty=2
  // discounted line was undercounted by ÷quantity. Trendyol sends per-unit amounts
  // (doc: "Ürünün birim brüt fiyatı" / "Birim satıcı indirimi"); the line/order total
  // is quantity × per-unit. Panel ground truth: Satış ₺4240, Faturalanacak ₺3816.
  it('scales sale, commission and seller-discount by quantity for a qty>1 discounted line', () => {
    // 2 adet × (birim brüt 2120 − birim satıcı indirim 212) = 2 × 1908 = 3816 brüt.
    // effectiveSale net = 3816 / 1.2 = 3180. unit net = 1908 / 1.2 = 1590.
    // grossComm = 2120 × 2 × %20 = 848 brüt → net 706.67. refunded = 212 × 2 × %20 = 84.8 → 70.67.
    // effComm = 706.67 − 70.67 = 636 = effectiveSale(3180) × %20 (komisyon net satış üzerinden).
    // sellerDiscount line-toplamı = 212 × 2 / 1.2 = 353.33.
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        lines: [
          buildLine({
            quantity: 2,
            lineGrossAmount: 2120,
            lineSellerDiscount: 212,
            lineUnitPrice: 1908,
            commission: 20,
            vatRate: 20,
          }),
        ],
      }),
      20,
    );

    expect(mapped.saleSubtotalNet).toBe('3180.00');
    expect(mapped.saleVatTotal).toBe('636.00');
    const line = mapped.lines[0];
    expect(line?.unitPriceNet).toBe('1590');
    expect(line?.grossCommissionAmountNet).toBe('706.67');
    expect(line?.refundedCommissionAmountNet).toBe('70.67');
    expect(line?.sellerDiscountNet).toBe('353.33');
  });

  it('aggregates correctly across mixed VAT rates (regression guard)', () => {
    // Multi-rate orders must NOT mix rates: each line's own VAT rate
    // drives its own split, then the aggregate sums the nets.
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        lines: [
          // 1 × (120 → 100 net @ 20%) = 100
          buildLine({ quantity: 1, lineUnitPrice: 120, lineGrossAmount: 120, vatRate: 20 }),
          // 1 × (110 → 100 net @ 10%) = 100
          buildLine({ quantity: 1, lineUnitPrice: 110, lineGrossAmount: 110, vatRate: 10 }),
        ],
      }),
    );

    expect(mapped.saleSubtotalNet).toBe('200.00');
    expect(mapped.saleVatTotal).toBe('30.00');
  });

  // ─── effectiveSale = liste − satıcı indirimi (denetim #1) ───────────
  it('builds saleSubtotalNet from effectiveSale (liste − satıcı indirimi), ignoring Trendyol discount', () => {
    // Stage co-funded sipariş #1359065292: liste 1690, satıcı indirim 845,
    // Trendyol indirim 507, müşteri öder (lineUnitPrice) 338, vatRate %10.
    // effectiveSale = 1690 − 845 = 845 → net 768.18 (845 / 1.10). Trendyol indirimi
    // (507) DÜŞÜLMEZ (geri ödeniyor, kâra etkisi YOK). Eski buggy mapper lineUnitPrice'tan
    // 338 / 1.10 = 307.27 kurardı — bu testin ayırt edici noktası tam burası.
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        lines: [
          buildLine({
            quantity: 1,
            lineGrossAmount: 1690,
            lineSellerDiscount: 845,
            lineTyDiscount: 507,
            lineUnitPrice: 338,
            vatRate: 10,
          }),
        ],
      }),
    );

    expect(mapped.saleSubtotalNet).toBe('768.18'); // 845 / 1.10 — NOT 338 / 1.10
    expect(mapped.saleVatTotal).toBe('76.82');
    // Satıcı indirimi yine de breakdown için ayrıştırılır (845 / 1.10).
    expect(mapped.lines[0]?.sellerDiscountNet).toBe('768.18');
    expect(mapped.lines[0]?.sellerDiscountVatAmount).toBe('76.82');
  });

  it('with no Trendyol discount, effectiveSale equals customer-paid (production parity)', () => {
    // Production sipariş #11319381127: liste 1340, satıcı indirim 24, ty 0.
    // effectiveSale = 1316 = müşteri öder (ty=0 olduğu için çakışır). net 1196.36.
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        lines: [
          buildLine({
            quantity: 1,
            lineGrossAmount: 1340,
            lineSellerDiscount: 24,
            lineTyDiscount: 0,
            lineUnitPrice: 1316,
            vatRate: 10,
          }),
        ],
      }),
    );

    expect(mapped.saleSubtotalNet).toBe('1196.36'); // 1316 / 1.10
    expect(mapped.saleVatTotal).toBe('119.64');
  });

  it('multi-line co-funded: her satır kendi effectiveSale + vatRate; aggregate tyDiscount hariç', () => {
    // İki indirimli satır, ikisinde de Trendyol payı. Her satır kendi effectiveSale'i
    // (liste − satıcı indirimi) ve vatRate'iyle; tyDiscount HİÇ düşülmez.
    // Σ(qty × unitPriceNet) == saleSubtotalNet invariant'ı (review gap'i) doğrulanır.
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        lines: [
          // Satır 1: liste 1200, satıcı 120, ty 300 → effectiveSale 1080 → net 900 (@%20)
          buildLine({
            lineId: 1,
            barcode: 'B-CF-1',
            quantity: 1,
            lineGrossAmount: 1200,
            lineSellerDiscount: 120,
            lineTyDiscount: 300,
            lineUnitPrice: 780,
            vatRate: 20,
          }),
          // Satır 2: BİRİM liste 720, birim satıcı 120, birim ty 100, qty 2 →
          // effectiveSale birim 600 → birim net 500 (@%20). lineUnitPrice = 720−120−100 = 500.
          buildLine({
            lineId: 2,
            barcode: 'B-CF-2',
            quantity: 2,
            lineGrossAmount: 720,
            lineSellerDiscount: 120,
            lineTyDiscount: 100,
            lineUnitPrice: 500,
            vatRate: 20,
          }),
        ],
      }),
    );

    // Per-line effectiveSale birim-net (müşteri-ödediği lineUnitPrice DEĞİL).
    expect(mapped.lines[0]?.unitPriceNet).toBe('900'); // 1080 / 1.2
    expect(mapped.lines[1]?.unitPriceNet).toBe('500'); // (720 − 120) / 1.2 — BİRİM, ÷qty YOK
    // Σ(qty × unitPriceNet) = 1×900 + 2×500 = 1900 (tyDiscount HARİÇ).
    expect(mapped.saleSubtotalNet).toBe('1900.00');
    expect(mapped.saleVatTotal).toBe('380.00');
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
    expect(mapped.lines[0]?.unitPriceNet).toBe('0');
    expect(mapped.lines[0]?.unitVatAmount).toBe('0');
    expect(mapped.saleSubtotalNet).toBe('0.00');
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
