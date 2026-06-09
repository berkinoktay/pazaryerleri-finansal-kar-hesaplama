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

import { describe, expect, it } from 'vitest';
import { getBusinessDate, getBusinessHour } from '@pazarsync/utils';

import {
  mapTrendyolOrdersResponse,
  mapTrendyolShipmentPackage,
  mapTrendyolStatusToEnum,
} from '../../src/trendyol/orders';
import type {
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
  lines?: TrendyolOrderLine[];
  packageHistories?: TrendyolPackageHistory[] | undefined;
  fastDelivery?: boolean;
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
    packageGrossAmount: 120,
    fastDelivery: overrides.fastDelivery ?? false,
    micro: overrides.micro ?? false,
    lines: overrides.lines ?? [buildLine()],
    packageHistories: overrides.packageHistories,
  };
}

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
});

// ─── Per-line KDV split ────────────────────────────────────────────────

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
    const mapped = mapTrendyolShipmentPackage(
      buildPackage({
        lines: [
          // 2 × (120 → 100 net) = 200
          buildLine({ quantity: 2, lineUnitPrice: 120, lineGrossAmount: 240, vatRate: 20 }),
          // 3 × (60 → 50 net) = 150
          buildLine({ quantity: 3, lineUnitPrice: 60, lineGrossAmount: 180, vatRate: 20 }),
        ],
      }),
    );

    expect(mapped.saleSubtotalNet).toBe('350.00');
    expect(mapped.saleVatTotal).toBe('70.00');
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
