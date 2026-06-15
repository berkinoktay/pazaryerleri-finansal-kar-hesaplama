// Test factories for Trendyol order payloads. Build valid
// TrendyolOrderLine / TrendyolShipmentPackage objects with sensible defaults,
// overridable per test. Kept small — only the fields the mapper reads.

import type {
  TrendyolOrderLine,
  TrendyolPackageHistory,
  TrendyolShipmentPackage,
} from '../../src/trendyol/types';

export function buildLine(overrides: Partial<TrendyolOrderLine> = {}): TrendyolOrderLine {
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

export interface PackageOverrides {
  status?: string;
  orderDate?: number;
  lastModifiedDate?: number;
  agreedDeliveryDate?: number | undefined;
  estimatedDeliveryStartDate?: number | undefined;
  estimatedDeliveryEndDate?: number | undefined;
  packageGrossAmount?: number;
  packageSellerDiscount?: number;
  packageTotalPrice?: number;
  lines?: TrendyolOrderLine[];
  packageHistories?: TrendyolPackageHistory[] | undefined;
  fastDelivery?: boolean;
  fastDeliveryType?: string | undefined;
  micro?: boolean;
}

export function buildPackage(overrides: PackageOverrides = {}): TrendyolShipmentPackage {
  return {
    orderNumber: 'ORDER-NUMBER-1',
    shipmentPackageId: 1234567,
    status: overrides.status ?? 'Created',
    orderDate: overrides.orderDate ?? Date.UTC(2026, 5, 8, 14, 0, 0),
    lastModifiedDate: overrides.lastModifiedDate ?? Date.UTC(2026, 5, 8, 14, 0, 0),
    agreedDeliveryDate: overrides.agreedDeliveryDate,
    estimatedDeliveryStartDate: overrides.estimatedDeliveryStartDate,
    estimatedDeliveryEndDate: overrides.estimatedDeliveryEndDate,
    packageGrossAmount: overrides.packageGrossAmount ?? 120,
    packageSellerDiscount: overrides.packageSellerDiscount,
    // Default the package total to the default single-line sale (120, no
    // discount) so the Σ-line = package invariant holds for unrelated tests
    // (status/cargo/date suites) without each having to set it. Money tests
    // that exercise discounts/multi-line set their own totals explicitly.
    packageTotalPrice: overrides.packageTotalPrice ?? 120,
    fastDelivery: overrides.fastDelivery ?? false,
    fastDeliveryType: overrides.fastDeliveryType,
    micro: overrides.micro ?? false,
    lines: overrides.lines ?? [buildLine()],
    packageHistories: overrides.packageHistories,
  };
}
