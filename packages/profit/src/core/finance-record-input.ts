import { type Decimal } from 'decimal.js';
import { type Prisma } from '@pazarsync/db';
import { type FinanceRecordFamily } from '@pazarsync/db/enums';

/**
 * A marketplace-agnostic raw finance-record, ready to be stored in
 * `marketplace_finance_records`. The pure per-marketplace builders produce it; the
 * persistence layer (`ingestFinanceRecords`) writes it. It lives in `core/` so the
 * pure Trendyol builders never import from `persistence/` -- the dependency arrow
 * points one way, from persistence to core.
 *
 * `transactionType` is the requested filter type (e.g. `Sale`, `PaymentOrder`, or a
 * cargo item label), never the Turkish response label; that label survives only in
 * `payload`. Money is VAT-included and in Turkish lira. `payload` is the full vendor
 * object, kept verbatim for debugging and forward-compat.
 */
export interface FinanceRecordInput {
  readonly family: FinanceRecordFamily;
  readonly transactionType: string;
  readonly recordId: string;
  readonly invoiceSerial: string | null;
  readonly orderNumber: string | null;
  readonly shipmentPackageId: string | null;
  readonly barcode: string | null;
  readonly paymentOrderId: string | null;
  readonly parcelUniqueId: string | null;
  readonly transactionDate: Date | null;
  readonly debt: Decimal | null;
  readonly credit: Decimal | null;
  readonly commissionAmount: Decimal | null;
  readonly amountGross: Decimal | null;
  readonly desi: Decimal | null;
  readonly payload: Prisma.InputJsonValue;
}
