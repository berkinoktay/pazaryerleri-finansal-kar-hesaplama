// Cargo invoice line items → per-order OrderFee SHIPPING / RETURN_SHIPPING
// (PR-8, research 2026-06-09).
//
// The cron pre-fetches the invoice's items OUTSIDE the row transaction
// (network call), then hands them here to be matched and written INSIDE it.
//
// Matching (proven on prod): item.parcelUniqueId == Order.cargoTrackingNumber
// — exact, package-level. Fallback: platformOrderNumber single match (legacy
// rows synced before the tracking column existed). Ambiguous (split order,
// no tracking match) or zero match → log + skip; the row is retried on the
// next settlement scan once the order sync has backfilled tracking numbers.
//
// VAT: item.amount is VAT-INCLUSIVE ("KDV tevkifat uygulanmamistir"). The
// rate comes from fee_definitions.default_vat_rate via resolveFeeDefinition
// (at = order.orderDate) — data-driven, never a code constant.
//
// Idempotency: externalRef carries {invoiceSerialNumber, parcelUniqueId,
// desi}; an existing CARGO_INVOICE fee on the same order+feeType with the
// same serial+parcel pair short-circuits the insert (weekly re-scans hit
// the same invoices repeatedly by design — 60d window).

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import type { CargoInvoiceItem, TrendyolFinancialTransaction } from '@pazarsync/marketplace';
import { resolveFeeDefinition } from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';

type CargoFeeType = 'SHIPPING' | 'RETURN_SHIPPING';

const PACKAGE_TYPE_TO_FEE: ReadonlyMap<string, CargoFeeType> = new Map([
  ['Gönderi Kargo Bedeli', 'SHIPPING'],
  ['İade Kargo Bedeli', 'RETURN_SHIPPING'],
]);

export interface CargoInvoiceFeesResult {
  writtenFees: number;
  dedupedItems: number;
  unmatchedItems: number;
  ambiguousItems: number;
  unknownTypeItems: number;
}

interface MatchedOrder {
  id: string;
  orderDate: Date;
  usesSellerCargoAgreement: boolean;
}

async function matchOrder(
  storeId: string,
  organizationId: string,
  item: CargoInvoiceItem,
  tx: Prisma.TransactionClient,
): Promise<{ order: MatchedOrder | null; ambiguous: boolean }> {
  const select = { id: true, orderDate: true, usesSellerCargoAgreement: true };

  const byTracking = await tx.order.findFirst({
    where: { organizationId, storeId, cargoTrackingNumber: BigInt(item.parcelUniqueId) },
    select,
  });
  if (byTracking !== null) return { order: byTracking, ambiguous: false };

  // Fallback: order number. take 2 — only a SINGLE match is trustworthy
  // (split orders share the number across packages).
  const byNumber = await tx.order.findMany({
    where: { organizationId, storeId, platformOrderNumber: item.orderNumber },
    select,
    take: 2,
  });
  if (byNumber.length === 1) return { order: byNumber[0] ?? null, ambiguous: false };
  return { order: null, ambiguous: byNumber.length > 1 };
}

function isSameParcelRef(
  ref: Prisma.JsonValue | null,
  invoiceSerialNumber: string,
  parcelUniqueId: string,
): boolean {
  if (typeof ref !== 'object' || ref === null || Array.isArray(ref)) return false;
  const record = ref as Record<string, unknown>;
  return (
    record['invoiceSerialNumber'] === invoiceSerialNumber &&
    record['parcelUniqueId'] === parcelUniqueId
  );
}

export async function handleCargoInvoiceItems(
  storeId: string,
  organizationId: string,
  row: TrendyolFinancialTransaction,
  items: CargoInvoiceItem[],
  tx: Prisma.TransactionClient,
): Promise<CargoInvoiceFeesResult> {
  const invoiceSerialNumber = row.id;
  const result: CargoInvoiceFeesResult = {
    writtenFees: 0,
    dedupedItems: 0,
    unmatchedItems: 0,
    ambiguousItems: 0,
    unknownTypeItems: 0,
  };

  for (const item of items) {
    const feeType = PACKAGE_TYPE_TO_FEE.get(item.shipmentPackageType);
    if (feeType === undefined) {
      result.unknownTypeItems += 1;
      syncLog.warn('settlements.cargo-invoice.unknown-package-type', {
        storeId,
        invoiceSerialNumber,
        shipmentPackageType: item.shipmentPackageType,
        parcelUniqueId: String(item.parcelUniqueId),
      });
      continue;
    }

    const { order, ambiguous } = await matchOrder(storeId, organizationId, item, tx);
    if (order === null) {
      if (ambiguous) {
        result.ambiguousItems += 1;
        syncLog.warn('settlements.cargo-invoice.ambiguous-order-match', {
          storeId,
          invoiceSerialNumber,
          orderNumber: item.orderNumber,
          parcelUniqueId: String(item.parcelUniqueId),
        });
      } else {
        result.unmatchedItems += 1;
        syncLog.info('settlements.cargo-invoice.no-order-match', {
          storeId,
          invoiceSerialNumber,
          orderNumber: item.orderNumber,
          parcelUniqueId: String(item.parcelUniqueId),
        });
      }
      continue;
    }

    const parcelUniqueId = String(item.parcelUniqueId);
    const existingFees = await tx.orderFee.findMany({
      where: { orderId: order.id, feeType, source: 'CARGO_INVOICE' },
      select: { externalRef: true },
    });
    if (
      existingFees.some((fee) =>
        isSameParcelRef(fee.externalRef, invoiceSerialNumber, parcelUniqueId),
      )
    ) {
      result.dedupedItems += 1;
      continue;
    }

    if (order.usesSellerCargoAgreement) {
      // whoPays==1 stores should never be billed by Trendyol — but if the
      // invoice line exists, Trendyol charged it, so it IS a real cost.
      syncLog.warn('settlements.cargo-invoice.seller-agreement-billed', {
        storeId,
        orderId: order.id,
        invoiceSerialNumber,
        parcelUniqueId,
      });
    }

    const definition = await resolveFeeDefinition(tx, {
      platform: 'TRENDYOL',
      feeType,
      at: order.orderDate,
    });

    const gross = new Decimal(item.amount);
    const vatRate = new Decimal(definition.defaultVatRate.toString());
    const amountNet = gross.div(vatRate.div(100).add(1)).toDecimalPlaces(2);
    const vatAmount = gross.sub(amountNet);

    await tx.orderFee.create({
      data: {
        orderId: order.id,
        organizationId,
        feeDefinitionId: definition.id,
        feeType,
        source: 'CARGO_INVOICE',
        direction: 'DEBIT',
        amountNet,
        vatRate,
        vatAmount,
        displayName: item.shipmentPackageType,
        externalRef: { invoiceSerialNumber, parcelUniqueId, desi: item.desi },
      },
    });
    result.writtenFees += 1;
  }

  syncLog.info('settlements.cargo-invoice.processed', {
    storeId,
    invoiceSerialNumber,
    itemCount: items.length,
    ...result,
  });
  return result;
}
