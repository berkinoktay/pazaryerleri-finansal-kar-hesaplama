// Cargo-invoice detection for Trendyol /otherfinancials DeductionInvoices rows.
//
// A DeductionInvoices row's kind is encoded in the TR-localized `transactionType`
// field VALUE of the response (the query param is EN, the response value is TR).
// classifyDeductionInvoice maps that label to a sub-class; getCargoInvoiceSerial
// uses it to decide whether a row is a cargo invoice and, if so, returns its
// invoice serial (the row id). The settlements cron uses the serial to pre-fetch
// the invoice items outside its store transaction, and the profit engine uses it
// to key the stored cargo-invoice items. Unknown labels degrade to
// `{ kind: 'unknown', raw }` instead of throwing on a new vendor label.
//
// Pure: no I/O, no Prisma.

import type { OrderFeeType } from '@pazarsync/db';

import type { OtherFinancialTransactionType, TrendyolFinancialTransaction } from './settlements';

/**
 * DeductionInvoices sub-classes — the TR-localized response
 * `transactionType` value discriminates which kind of deduction this row
 * represents (research §4.4 + design §5.2 line 1098..1108).
 */
export type DeductionInvoiceSubClass =
  | { kind: 'platform_service_fee' }
  | { kind: 'cargo_invoice' }
  | { kind: 'advertising' }
  | { kind: 'commission_invoice' }
  | {
      kind: 'penalty';
      feeType: OrderFeeType; /* PENALTY_DEFECTIVE / _WRONG_PRODUCT / _MISSING_PRODUCT / _LATE_DELIVERY / _SUPPLY_FAILURE */
    }
  | { kind: 'notification_fee' }
  | {
      kind: 'unknown';
      raw: string; /* graceful degradation — a human adds the mapping later */
    };

/**
 * TR-localized response `transactionType` value → DeductionInvoice
 * sub-class. Source-of-truth: research §4.4 + design §5.2 line 1098+.
 * Unknown labels return `{ kind: 'unknown', raw }` so a new vendor label
 * never crashes the caller.
 */
const DEDUCTION_INVOICE_LABELS = new Map<string, DeductionInvoiceSubClass>([
  ['Platform Hizmet Bedeli', { kind: 'platform_service_fee' }],
  ['Kargo Fatura', { kind: 'cargo_invoice' }],
  ['Kargo Faturası', { kind: 'cargo_invoice' }], // both spellings observed
  ['Reklam Bedeli', { kind: 'advertising' }],
  ['Komisyon Faturası', { kind: 'commission_invoice' }],
  ['Kusurlu Ürün Faturası', { kind: 'penalty', feeType: 'PENALTY_DEFECTIVE' }],
  ['Yanlış Ürün Faturası', { kind: 'penalty', feeType: 'PENALTY_WRONG_PRODUCT' }],
  ['Eksik Ürün Faturası', { kind: 'penalty', feeType: 'PENALTY_MISSING_PRODUCT' }],
  ['Termin Gecikme Bedeli', { kind: 'penalty', feeType: 'PENALTY_LATE_DELIVERY' }],
  ['Tedarik Edememe Faturası', { kind: 'penalty', feeType: 'PENALTY_SUPPLY_FAILURE' }],
  ['Müşteri Duyuruları Faturası', { kind: 'notification_fee' }],
]);

export function classifyDeductionInvoice(
  responseTransactionType: string,
): DeductionInvoiceSubClass {
  return (
    DEDUCTION_INVOICE_LABELS.get(responseTransactionType) ?? {
      kind: 'unknown',
      raw: responseTransactionType,
    }
  );
}

/**
 * Returns the invoice serial (the row id) when an /otherfinancials row is a
 * DeductionInvoices cargo invoice ("Kargo Fatura" / "Kargo Faturası"), else
 * null. The settlements cron fetches cargo-invoice/{serial}/items over the
 * network outside its store transaction, then stores the invoice row and its
 * items raw in one transaction.
 */
export function getCargoInvoiceSerial(
  requestedType: OtherFinancialTransactionType,
  row: TrendyolFinancialTransaction,
): string | null {
  if (requestedType !== 'DeductionInvoices') return null;
  const subClass = classifyDeductionInvoice(row.transactionType);
  return subClass.kind === 'cargo_invoice' ? row.id : null;
}
