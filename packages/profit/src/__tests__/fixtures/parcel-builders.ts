import { Decimal } from 'decimal.js';
import { getBusinessDate } from '@pazarsync/utils';

import { type ParcelItemSnapshot, type ParcelSnapshot } from '../../core/parcel-snapshot';

/**
 * Builds a parcel item for tests. Money, rate and desi fields are given as text
 * and converted to `Decimal`, like Phase 1's `makeLine`. `orderItemId` and
 * `listGross` are required; everything else defaults. When `saleGross` is
 * omitted it is `listGross - sellerDiscountGross`.
 */
export interface MakeItemParams {
  readonly orderItemId: string;
  readonly listGross: string;
  readonly sellerDiscountGross?: string;
  readonly saleGross?: string;
  readonly saleVatRatePct?: string;
  readonly quantity?: number;
  readonly unitDesi?: string | null;
  readonly isDigital?: boolean;
  readonly isCancelled?: boolean;
  readonly productVariantId?: string | null;
  readonly barcode?: string | null;
}

export function makeItem(params: MakeItemParams): ParcelItemSnapshot {
  const listGross = new Decimal(params.listGross);
  const sellerDiscountGross = new Decimal(params.sellerDiscountGross ?? '0');
  const saleGross =
    params.saleGross === undefined
      ? listGross.sub(sellerDiscountGross)
      : new Decimal(params.saleGross);
  const unitDesiText = params.unitDesi === undefined ? '1' : params.unitDesi;
  return {
    orderItemId: params.orderItemId,
    productVariantId:
      params.productVariantId === undefined
        ? `variant-${params.orderItemId}`
        : params.productVariantId,
    barcode: params.barcode === undefined ? `bc-${params.orderItemId}` : params.barcode,
    quantity: params.quantity ?? 1,
    listGross,
    sellerDiscountGross,
    saleGross,
    saleVatRatePct: new Decimal(params.saleVatRatePct ?? '20'),
    unitDesi: unitDesiText === null ? null : new Decimal(unitDesiText),
    isDigital: params.isDigital ?? false,
    isCancelled: params.isCancelled ?? false,
  };
}

/**
 * Builds a parcel snapshot for tests. `businessDate` defaults to
 * `getBusinessDate(orderDate)` so overriding `orderDate` stays consistent.
 * `measuredDesi` is given as text and converted to `Decimal` when present.
 */
export interface MakeParcelParams {
  readonly parcelId?: string;
  readonly orderDate?: Date;
  readonly businessDate?: string;
  readonly isCancelled?: boolean;
  readonly isExportSale?: boolean;
  readonly measuredDesi?: string | null;
  readonly items?: readonly ParcelItemSnapshot[];
}

export function makeParcel(params: MakeParcelParams = {}): ParcelSnapshot {
  const orderDate = params.orderDate ?? new Date('2026-10-28T09:00:00Z');
  const measuredDesi =
    params.measuredDesi === undefined || params.measuredDesi === null
      ? null
      : new Decimal(params.measuredDesi);
  return {
    parcelId: params.parcelId ?? 'parcel-1',
    orderDate,
    businessDate: params.businessDate ?? getBusinessDate(orderDate),
    isCancelled: params.isCancelled ?? false,
    isExportSale: params.isExportSale ?? false,
    measuredDesi,
    items: params.items ?? [],
  };
}
