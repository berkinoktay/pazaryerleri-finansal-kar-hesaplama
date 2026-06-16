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
// GROSS CONVENTION: item.amount KDV-dahil (gross). amountGross doğrudan
// yazılır; vatRate fee_definitions.default_vat_rate'ten (data-driven).
// Net türetilir (amountGross × 100/(100+vatRate)) — API katmanında.
//
// Idempotency (#297): the invoice line identity lives in the indexed
// invoiceSerialNumber + parcelUniqueId columns; an existing CARGO_INVOICE
// fee on the same order with the same serial+parcel pair short-circuits
// the insert (weekly re-scans hit the same invoices repeatedly by design
// — 60d window). The lookup deliberately matches the DB partial unique
// (order_id, invoice_serial_number, parcel_unique_id) WHERE
// source='CARGO_INVOICE' exactly — feeType is NOT part of the key, so a
// reclassified line (Gönderi↔İade on a re-scan) dedupes instead of
// tripping the unique. externalRef keeps {invoiceSerialNumber,
// parcelUniqueId, desi} as audit-only.

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import type { CargoInvoiceItem, TrendyolFinancialTransaction } from '@pazarsync/marketplace';
import { resolveFeeDefinition } from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';

import { tryFinalizeReconciliation } from './finalize-reconciliation';

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
    const existingFee = await tx.orderFee.findFirst({
      where: { orderId: order.id, source: 'CARGO_INVOICE', invoiceSerialNumber, parcelUniqueId },
      select: { id: true },
    });
    if (existingFee !== null) {
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

    // GROSS CONVENTION (2026-06-16, Bölüm E): item.amount KDV-dahil (gross).
    // Net-split kaldırıldı; amountGross doğrudan yazılır, vatRate fee-definition'dan.
    const amountGross = new Decimal(item.amount);
    const vatRate = new Decimal(definition.defaultVatRate.toString());

    await tx.orderFee.create({
      data: {
        orderId: order.id,
        organizationId,
        feeDefinitionId: definition.id,
        feeType,
        source: 'CARGO_INVOICE',
        direction: 'DEBIT',
        amountGross,
        vatRate,
        displayName: item.shipmentPackageType,
        invoiceSerialNumber,
        parcelUniqueId,
        // Audit-only blob — idempotency reads use the columns above.
        externalRef: { invoiceSerialNumber, parcelUniqueId, desi: item.desi },
      },
    });
    result.writtenFees += 1;

    // Real cargo just landed → this may be the last estimate the order was
    // waiting on. Re-run the finalize gate: if the payment cycle is already
    // confirmed, the order now flips to FULLY_SETTLED with the real cargo in
    // settledNetProfit. No-op if payment hasn't arrived yet (PaymentOrder
    // cascade will finalize then). Cargo can arrive before OR after payment.
    await tryFinalizeReconciliation(order.id, tx);
  }

  syncLog.info('settlements.cargo-invoice.processed', {
    storeId,
    invoiceSerialNumber,
    itemCount: items.length,
    ...result,
  });
  return result;
}
