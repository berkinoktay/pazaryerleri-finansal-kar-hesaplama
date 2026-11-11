import { Decimal } from 'decimal.js';
import { FinanceRecordFamily } from '@pazarsync/db/enums';
import {
  getCargoInvoiceSerial,
  type CargoInvoiceItem,
  type OtherFinancialTransactionType,
  type SettlementTransactionType,
  type TrendyolFinancialTransaction,
} from '@pazarsync/marketplace';

import { type FinanceRecordInput } from '../../core/finance-record-input';

/**
 * Pure converters from raw Trendyol settlement / otherfinancials / cargo-invoice
 * rows to marketplace-agnostic `FinanceRecordInput`s. No DB or Prisma awareness; the
 * persistence layer stores what these return. Every numeric id becomes a string,
 * every money value is read as `new Decimal(String(x))` (null stays null), and the
 * full vendor object is kept in `payload`. The record's `transactionType` is the
 * REQUESTED filter type, never the Turkish response label.
 *
 * The otherfinancials request subtype `DeductionInvoices` requires a Kargo Fatura
 * row. `DeductionInvoices` request type found via `OTHER_FINANCIAL_TRANSACTION_TYPES`.
 */
const DEDUCTION_INVOICES: OtherFinancialTransactionType = 'DeductionInvoices';

/** A vendor money number -> a fresh decimal.js value; null stays null. */
function money(value: number | null): Decimal | null {
  return value === null ? null : new Decimal(String(value));
}

/** A vendor numeric id -> its text form; null stays null. */
function idText(value: number | null): string | null {
  return value === null ? null : String(value);
}

/** The invoice serial a settlement or otherfinancials row carries. */
function invoiceSerialFor(
  requestedType: SettlementTransactionType | OtherFinancialTransactionType,
  row: TrendyolFinancialTransaction,
): string | null {
  // A deduction invoice has no commission serial of its own; its own id IS the serial.
  if (requestedType === DEDUCTION_INVOICES) {
    return row.id;
  }
  return row.commissionInvoiceSerialNumber ?? null;
}

/**
 * One `/settlements` row -> a SETTLEMENT finance-record input. The requested filter
 * type (Sale / Return / Discount / ...) is the stored type; the response label stays
 * in the payload. Debt, credit and commission amount are filled; cargo columns stay
 * null.
 */
export function trendyolSettlementRecordInput(
  requestedType: SettlementTransactionType,
  row: TrendyolFinancialTransaction,
): FinanceRecordInput {
  return {
    family: FinanceRecordFamily.SETTLEMENT,
    transactionType: requestedType,
    recordId: row.id,
    invoiceSerial: invoiceSerialFor(requestedType, row),
    orderNumber: row.orderNumber,
    shipmentPackageId: idText(row.shipmentPackageId),
    barcode: row.barcode,
    paymentOrderId: idText(row.paymentOrderId),
    parcelUniqueId: null,
    transactionDate: new Date(row.transactionDate),
    debt: money(row.debt),
    credit: money(row.credit),
    commissionAmount: money(row.commissionAmount),
    amountGross: null,
    desi: null,
    payload: { ...row },
  };
}

/**
 * One `/otherfinancials` row -> an OTHER_FINANCIAL finance-record input. Same column
 * rules as a settlement row; a `DeductionInvoices` row carries its own id as the
 * invoice serial.
 */
export function trendyolOtherFinancialRecordInput(
  requestedType: OtherFinancialTransactionType,
  row: TrendyolFinancialTransaction,
): FinanceRecordInput {
  return {
    family: FinanceRecordFamily.OTHER_FINANCIAL,
    transactionType: requestedType,
    recordId: row.id,
    invoiceSerial: invoiceSerialFor(requestedType, row),
    orderNumber: row.orderNumber,
    shipmentPackageId: idText(row.shipmentPackageId),
    barcode: row.barcode,
    paymentOrderId: idText(row.paymentOrderId),
    parcelUniqueId: null,
    transactionDate: new Date(row.transactionDate),
    debt: money(row.debt),
    credit: money(row.credit),
    commissionAmount: money(row.commissionAmount),
    amountGross: null,
    desi: null,
    payload: { ...row },
  };
}

/**
 * The cargo-invoice Kargo Fatura row + its fetched items -> one CARGO_INVOICE_ITEM
 * finance-record input per item. A cargo item has no id of its own, so the record id
 * is `"<invoice serial>:<parcelUniqueId>"`, where the invoice serial is the parent
 * row's id (reusing `getCargoInvoiceSerial`, the single source of that rule). The
 * item label (Gonderi / Iade) is the stored type; the invoice row's date is the
 * transaction date. Amount and desi are filled; the settlement money columns stay
 * null.
 */
export function trendyolCargoInvoiceItemInputs(
  invoiceRow: TrendyolFinancialTransaction,
  items: readonly CargoInvoiceItem[],
): FinanceRecordInput[] {
  const invoiceSerial = getCargoInvoiceSerial(DEDUCTION_INVOICES, invoiceRow);
  if (invoiceSerial === null) {
    throw new Error(`Finance row ${invoiceRow.id} is not a cargo invoice row`);
  }
  const transactionDate = new Date(invoiceRow.transactionDate);
  return items.map((item) => {
    const parcelUniqueId = String(item.parcelUniqueId);
    return {
      family: FinanceRecordFamily.CARGO_INVOICE_ITEM,
      transactionType: item.shipmentPackageType,
      recordId: `${invoiceSerial}:${parcelUniqueId}`,
      invoiceSerial,
      orderNumber: item.orderNumber,
      shipmentPackageId: null,
      barcode: null,
      paymentOrderId: null,
      parcelUniqueId,
      transactionDate,
      debt: null,
      credit: null,
      commissionAmount: null,
      amountGross: money(item.amount),
      desi: money(item.desi),
      payload: { ...item },
    };
  });
}
