import { type Decimal } from 'decimal.js';
import { getBusinessDate } from '@pazarsync/utils';

import { kurusAmountViolation } from '../money';
import { type CurrencyCode } from './fx/currency-code';

/** All money is VAT included and in the parcel's accounting currency. */
export interface ParcelItemSnapshot {
  readonly orderItemId: string;
  readonly productVariantId: string | null;
  readonly barcode: string | null;
  readonly quantity: number; // integer >= 1
  readonly listGross: Decimal; // line list total before any discount
  readonly sellerDiscountGross: Decimal; // seller-funded discount on the line
  readonly saleGross: Decimal; // listGross - sellerDiscountGross; a marketplace-funded discount does not reduce it
  readonly saleVatRatePct: Decimal; // product VAT rate; the export rule is applied by the tax module
  readonly unitDesi: Decimal | null; // product desi per unit; null = unknown
  readonly isDigital: boolean;
  readonly isCancelled: boolean; // line cancelled before shipment
}

export interface ParcelSnapshot {
  readonly parcelId: string;
  readonly orderDate: Date;
  readonly businessDate: string; // YYYY-MM-DD, getBusinessDate(orderDate)
  readonly isCancelled: boolean;
  readonly isExportSale: boolean;
  readonly measuredDesi: Decimal | null; // parcel desi measured by the marketplace or carrier
  readonly accountingCurrency: CurrencyCode;
  readonly items: readonly ParcelItemSnapshot[];
}

export interface AcceptedReturn {
  readonly orderItemId: string;
  readonly acceptedQuantity: number;
}

export class InvalidParcelSnapshotError extends Error {}

/** Human-readable fragment for each kurus violation, used in field messages. */
const MONEY_VIOLATION_MESSAGE: Record<
  NonNullable<ReturnType<typeof kurusAmountViolation>>,
  string
> = {
  NOT_FINITE: 'must be a finite number',
  NEGATIVE: 'must not be negative',
  TOO_MANY_DECIMALS: 'must not have more than two decimals',
};

function assertMoneyField(value: Decimal, field: string): void {
  const violation = kurusAmountViolation(value);
  if (violation !== null) {
    throw new InvalidParcelSnapshotError(`${field} ${MONEY_VIOLATION_MESSAGE[violation]}`);
  }
}

function assertDesiField(value: Decimal | null, field: string): void {
  if (value === null) {
    return;
  }
  if (!value.isFinite() || value.lt(0)) {
    throw new InvalidParcelSnapshotError(`${field} must be null or a non-negative finite number`);
  }
}

/**
 * Validates the marketplace-agnostic parcel snapshot and throws
 * `InvalidParcelSnapshotError` naming the field and the broken rule.
 */
export function assertParcelSnapshot(snapshot: ParcelSnapshot): void {
  const expectedBusinessDate = getBusinessDate(snapshot.orderDate);
  if (snapshot.businessDate !== expectedBusinessDate) {
    throw new InvalidParcelSnapshotError(
      `businessDate ${snapshot.businessDate} must equal getBusinessDate(orderDate) ${expectedBusinessDate}`,
    );
  }

  assertDesiField(snapshot.measuredDesi, 'measuredDesi');

  const seenOrderItemIds = new Set<string>();
  snapshot.items.forEach((item, index) => {
    const field = `items[${index.toString()}]`;

    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new InvalidParcelSnapshotError(`${field}.quantity must be an integer >= 1`);
    }

    assertMoneyField(item.listGross, `${field}.listGross`);
    assertMoneyField(item.sellerDiscountGross, `${field}.sellerDiscountGross`);
    assertMoneyField(item.saleGross, `${field}.saleGross`);

    if (!item.saleGross.equals(item.listGross.sub(item.sellerDiscountGross))) {
      throw new InvalidParcelSnapshotError(
        `${field}.saleGross must equal listGross - sellerDiscountGross`,
      );
    }

    assertDesiField(item.unitDesi, `${field}.unitDesi`);

    if (seenOrderItemIds.has(item.orderItemId)) {
      throw new InvalidParcelSnapshotError(
        `${field}.orderItemId '${item.orderItemId}' is not unique`,
      );
    }
    seenOrderItemIds.add(item.orderItemId);
  });
}

/** The items that were not cancelled, in input order. */
export function activeItems(snapshot: ParcelSnapshot): readonly ParcelItemSnapshot[] {
  return snapshot.items.filter((item) => !item.isCancelled);
}

/**
 * Validates accepted returns against the snapshot and throws
 * `InvalidParcelSnapshotError` naming the broken rule.
 */
export function assertAcceptedReturns(
  snapshot: ParcelSnapshot,
  accepted: readonly AcceptedReturn[],
): void {
  const activeByOrderItemId = new Map<string, ParcelItemSnapshot>();
  for (const item of activeItems(snapshot)) {
    activeByOrderItemId.set(item.orderItemId, item);
  }

  const seenOrderItemIds = new Set<string>();
  for (const entry of accepted) {
    const item = activeByOrderItemId.get(entry.orderItemId);
    if (item === undefined) {
      throw new InvalidParcelSnapshotError(
        `accepted return orderItemId '${entry.orderItemId}' is not an active item of the parcel`,
      );
    }

    if (seenOrderItemIds.has(entry.orderItemId)) {
      throw new InvalidParcelSnapshotError(
        `accepted return orderItemId '${entry.orderItemId}' is listed more than once`,
      );
    }
    seenOrderItemIds.add(entry.orderItemId);

    if (
      !Number.isInteger(entry.acceptedQuantity) ||
      entry.acceptedQuantity < 1 ||
      entry.acceptedQuantity > item.quantity
    ) {
      throw new InvalidParcelSnapshotError(
        `accepted return orderItemId '${entry.orderItemId}' acceptedQuantity must be an integer between 1 and ${item.quantity.toString()}`,
      );
    }
  }
}
