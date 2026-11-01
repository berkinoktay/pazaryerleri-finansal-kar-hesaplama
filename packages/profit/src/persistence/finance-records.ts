import { type Decimal } from 'decimal.js';
import { Prisma } from '@pazarsync/db';
import { FinanceRecordFamily, type Platform, ProfitRecomputeReason } from '@pazarsync/db/enums';

import { type FinanceRecordInput } from '../core/finance-record-input';
import { TRENDYOL_PAYMENT_ORDER_TRANSACTION_TYPE } from '../marketplaces/trendyol/settlement-records';
import { enqueueProfitRecompute } from './recompute-queue';

/**
 * Raw finance-record ingest (Phase 3B, Gorev 6). Stores vendor settlement,
 * otherfinancials and cargo-invoice rows verbatim in `marketplace_finance_records`,
 * then enqueues exactly the orders the loader would hand those records to. Both steps
 * run inside the caller's transaction (the settlement cron owns the maxWait/timeout),
 * so the just-inserted settlement rows are visible to the payment-order resolve below.
 *
 * All writes are raw SQL with bound parameters (never string concatenation). The
 * store (write) is one `INSERT ... SELECT ... ON CONFLICT`; the resolve is one
 * `SELECT`. `marketplace_finance_records` has no `updated_at` DB trigger, so the
 * conflict path sets it by hand with `clock_timestamp()`. Records are deduplicated on
 * their `(family, record_id)` conflict key before the write, and `transaction_date`
 * binds as `::timestamp(3)` to match the time-zone-less column.
 *
 * Tenant isolation: the INSERT joins the given store filtered by both its id and the
 * caller's organization, so a store that is not this organization's stores nothing;
 * the resolve and enqueue are both store-scoped and the enqueue re-checks the
 * organization, so another tenant's order can never enter the queue.
 */

/** Only a text of all-digits is a numeric cargo tracking number the index can match. */
const NUMERIC_ID = /^\d+$/;

/** One marketplace_finance_records VALUES tuple; every column after store_id. */
function financeRecordValuesRow(platform: Platform, record: FinanceRecordInput): Prisma.Sql {
  return Prisma.sql`(
    gen_random_uuid(),
    ${platform}::"Platform",
    ${record.family}::"FinanceRecordFamily",
    ${record.transactionType}::text,
    ${record.recordId}::text,
    ${record.invoiceSerial}::text,
    ${record.orderNumber}::text,
    ${record.shipmentPackageId}::text,
    ${record.barcode}::text,
    ${record.paymentOrderId}::text,
    ${record.parcelUniqueId}::text,
    ${record.transactionDate}::timestamp(3),
    ${numericParam(record.debt)}::numeric,
    ${numericParam(record.credit)}::numeric,
    ${numericParam(record.commissionAmount)}::numeric,
    ${numericParam(record.amountGross)}::numeric,
    ${numericParam(record.desi)}::numeric,
    ${JSON.stringify(record.payload)}::jsonb,
    clock_timestamp(),
    clock_timestamp(),
    clock_timestamp()
  )`;
}

/** A decimal.js value as a fixed-notation string for a `numeric` bind; null stays null. */
function numericParam(value: Decimal | null): string | null {
  return value === null ? null : value.toFixed();
}

/**
 * Collapses records that repeat a `(family, record_id)` conflict key so the single
 * `INSERT ... ON CONFLICT DO UPDATE` never carries the same key twice. Postgres would
 * otherwise raise "ON CONFLICT DO UPDATE command cannot affect row a second time" and
 * drop the whole call (e.g. an entire cargo invoice whose items repeat a parcel id).
 * The last occurrence wins, matching a re-poll where the later row is the fresher truth.
 * The write is order-independent, so the returned order carries no meaning.
 */
function dedupeByConflictKey(records: readonly FinanceRecordInput[]): FinanceRecordInput[] {
  const byKey = new Map<string, FinanceRecordInput>();
  for (const record of records) {
    byKey.set(`${record.family}\u0000${record.recordId}`, record);
  }
  return [...byKey.values()];
}

/**
 * Upserts every record on `(store_id, family, record_id)`. organization_id and
 * store_id come from the `stores` row (not the caller's raw ids), and the CROSS JOIN
 * matches nothing unless the store belongs to the organization, so a mismatch stores
 * nothing. Returns the affected row count (inserted + updated).
 */
function storeFinanceRecords(
  tx: Prisma.TransactionClient,
  params: {
    readonly organizationId: string;
    readonly storeId: string;
    readonly platform: Platform;
    readonly records: readonly FinanceRecordInput[];
  },
): Promise<number> {
  const valueRows = params.records.map((record) => financeRecordValuesRow(params.platform, record));
  return tx.$executeRaw`
    INSERT INTO marketplace_finance_records (
      organization_id, store_id, id, platform, family, transaction_type, record_id,
      invoice_serial, order_number, shipment_package_id, barcode, payment_order_id, parcel_unique_id,
      transaction_date, debt, credit, commission_amount, amount_gross, desi, payload,
      fetched_at, created_at, updated_at
    )
    SELECT s.organization_id, s.id, v.*
    FROM (VALUES ${Prisma.join(valueRows)}) v (
      id, platform, family, transaction_type, record_id,
      invoice_serial, order_number, shipment_package_id, barcode, payment_order_id, parcel_unique_id,
      transaction_date, debt, credit, commission_amount, amount_gross, desi, payload,
      fetched_at, created_at, updated_at
    )
    CROSS JOIN stores s
    WHERE s.id = ${params.storeId}::uuid AND s.organization_id = ${params.organizationId}::uuid
    ON CONFLICT (store_id, family, record_id) DO UPDATE SET
      platform = EXCLUDED.platform,
      transaction_type = EXCLUDED.transaction_type,
      invoice_serial = EXCLUDED.invoice_serial,
      order_number = EXCLUDED.order_number,
      shipment_package_id = EXCLUDED.shipment_package_id,
      barcode = EXCLUDED.barcode,
      payment_order_id = EXCLUDED.payment_order_id,
      parcel_unique_id = EXCLUDED.parcel_unique_id,
      transaction_date = EXCLUDED.transaction_date,
      debt = EXCLUDED.debt,
      credit = EXCLUDED.credit,
      commission_amount = EXCLUDED.commission_amount,
      amount_gross = EXCLUDED.amount_gross,
      desi = EXCLUDED.desi,
      payload = EXCLUDED.payload,
      fetched_at = EXCLUDED.fetched_at,
      updated_at = clock_timestamp()
  `;
}

/** Distinct, non-null text keys of the records in `family` read from `pick`. */
function distinctKeys(
  records: readonly FinanceRecordInput[],
  predicate: (record: FinanceRecordInput) => boolean,
  pick: (record: FinanceRecordInput) => string | null,
): string[] {
  const keys = new Set<string>();
  for (const record of records) {
    if (!predicate(record)) continue;
    const key = pick(record);
    if (key !== null) keys.add(key);
  }
  return [...keys];
}

/** Distinct numeric-only cargo tracking numbers (as bigint) among CARGO records. */
function distinctCargoTrackingNumbers(records: readonly FinanceRecordInput[]): bigint[] {
  const byText = new Map<string, bigint>();
  for (const record of records) {
    if (record.family !== FinanceRecordFamily.CARGO_INVOICE_ITEM) continue;
    const key = record.parcelUniqueId;
    if (key === null || !NUMERIC_ID.test(key)) continue; // a non-numeric parcel id cannot match the bigint column
    byText.set(key, BigInt(key));
  }
  return [...byText.values()];
}

/**
 * The store's orders the given records bind to, mirroring the loader exactly. A
 * settlement record binds the order whose outbound package is its shipment package,
 * or a claim's return package; a PaymentOrder record binds the orders tied to this
 * store's stored settlement records carrying that payment order; a cargo item binds
 * the order (or a claim) whose cargo tracking number is its parcel unique id. Every
 * clause is store-scoped. Returns distinct order ids.
 */
async function resolveAffectedOrderIds(
  tx: Prisma.TransactionClient,
  params: { readonly storeId: string; readonly records: readonly FinanceRecordInput[] },
): Promise<string[]> {
  const { storeId, records } = params;
  const shipmentPackageIds = distinctKeys(
    records,
    (record) => record.family === FinanceRecordFamily.SETTLEMENT,
    (record) => record.shipmentPackageId,
  );
  const paymentOrderIds = distinctKeys(
    records,
    (record) =>
      record.family === FinanceRecordFamily.OTHER_FINANCIAL &&
      record.transactionType === TRENDYOL_PAYMENT_ORDER_TRANSACTION_TYPE,
    (record) => record.paymentOrderId,
  );
  const cargoTrackingNumbers = distinctCargoTrackingNumbers(records);

  if (
    shipmentPackageIds.length === 0 &&
    paymentOrderIds.length === 0 &&
    cargoTrackingNumbers.length === 0
  ) {
    return [];
  }

  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT o.id AS "id"
    FROM orders o
    WHERE o.store_id = ${storeId}::uuid
      AND (
        o.platform_order_id = ANY(${shipmentPackageIds}::text[])
        OR o.cargo_tracking_number = ANY(${cargoTrackingNumbers}::int8[])
        OR EXISTS (
          SELECT 1 FROM order_claims c
          WHERE c.order_id = o.id
            AND c.store_id = ${storeId}::uuid
            AND (
              c.order_shipment_package_id = ANY(${shipmentPackageIds}::text[])
              OR c.cargo_tracking_number = ANY(${cargoTrackingNumbers}::int8[])
            )
        )
        OR EXISTS (
          SELECT 1 FROM marketplace_finance_records r
          WHERE r.store_id = ${storeId}::uuid
            AND r.family = 'SETTLEMENT'::"FinanceRecordFamily"
            AND r.payment_order_id = ANY(${paymentOrderIds}::text[])
            AND (
              r.shipment_package_id = o.platform_order_id
              OR EXISTS (
                SELECT 1 FROM order_claims c2
                WHERE c2.order_id = o.id
                  AND c2.store_id = ${storeId}::uuid
                  AND c2.order_shipment_package_id = r.shipment_package_id
              )
            )
        )
      )
  `;
  return rows.map((row) => row.id);
}

/**
 * Stores the records idempotently and enqueues a profit recompute for every order
 * they bind to. An empty records list makes no query. A store/organization mismatch
 * stores nothing and enqueues nothing. `stored` is the affected row count;
 * `enqueuedOrders` is the number of queue rows written.
 */
export async function ingestFinanceRecords(
  tx: Prisma.TransactionClient,
  params: {
    readonly organizationId: string;
    readonly storeId: string;
    readonly platform: Platform;
    readonly records: readonly FinanceRecordInput[];
  },
): Promise<{ readonly stored: number; readonly enqueuedOrders: number }> {
  const { organizationId, storeId, platform } = params;
  if (params.records.length === 0) {
    return { stored: 0, enqueuedOrders: 0 };
  }
  // Collapse same-key repeats before building the VALUES list so one ON CONFLICT write
  // never touches a conflict key twice. `stored` then counts the collapsed rows.
  const records = dedupeByConflictKey(params.records);

  const stored = await storeFinanceRecords(tx, { organizationId, storeId, platform, records });
  if (stored === 0) {
    // The CROSS JOIN matched no store: the store is not this organization's, so
    // nothing was stored and nothing may be enqueued (tenant defense).
    return { stored: 0, enqueuedOrders: 0 };
  }

  const orderIds = await resolveAffectedOrderIds(tx, { storeId, records });
  const enqueuedOrders = await enqueueProfitRecompute(tx, {
    organizationId,
    storeId,
    reason: ProfitRecomputeReason.FINANCE_RECORD,
    orderIds,
  });
  return { stored, enqueuedOrders };
}
