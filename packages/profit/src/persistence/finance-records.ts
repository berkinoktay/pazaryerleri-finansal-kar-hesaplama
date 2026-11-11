import { type Decimal } from 'decimal.js';
import { Prisma, type PrismaClient } from '@pazarsync/db';
import { FinanceRecordFamily, type Platform, ProfitRecomputeReason } from '@pazarsync/db/enums';

import { type FinanceRecordInput } from '../core/finance-record-input';
import { TRENDYOL_PAYMENT_ORDER_TRANSACTION_TYPE } from '../marketplaces/trendyol/settlement-records';
import { enqueueProfitRecompute } from './recompute-queue';

/**
 * Raw finance-record outbox (Phase 3B, Gorev 6), in two phases. The settlement cron
 * re-reads a wide window every few hours, so most re-polled rows are unchanged; writing
 * them back and recomputing their orders on every scan would be almost entirely no-ops.
 *
 * Phase 1 -- `ingestFinanceRecords` -- only stores: it upserts vendor settlement,
 * otherfinancials and cargo-invoice rows verbatim in `marketplace_finance_records` and
 * flags every row it inserts or actually changes `bind_pending = true`. An unchanged
 * re-poll touches nothing. It runs inside the caller's transaction (the cron owns the
 * maxWait/timeout) and neither resolves orders nor enqueues.
 *
 * Phase 2 -- `bindPendingFinanceRecords` -- runs AFTER that transaction commits, on the
 * root client: it claims the flagged rows, clears the flag, resolves the orders they
 * bind to, and enqueues a profit recompute. Running after the commit lets a bind pass
 * resolve a record against the orders a concurrent sync already committed, which an
 * inline resolve inside the ingest transaction could miss. Correctness for a record whose
 * order does not exist yet is NOT carried by the flag: a bind pass clears bind_pending for
 * every row it claims, resolved or not, so a record stored before its order enqueues
 * nothing here and is never re-picked. That late-order case is closed by the OTHER path --
 * upsertOrderWithSnapshot (packages/order-sync/src/upsert-order.ts) enqueues an
 * ORDER_CHANGED recompute on every order create, and that recompute reads the
 * already-stored finance record. The two paths are symmetric: this bind pass catches an
 * order that exists when the record commits; the order-create enqueue catches a record
 * whose order is created later.
 *
 * A third path covers records bound through a claim. The B3, B4 and B6 branches resolve
 * an order through a claim's return package id or cargo tracking number, so a return
 * settlement row (or its PaymentOrder) or a return cargo-invoice item stored BEFORE its
 * claim -- or before the claim carried those numbers -- resolves no order here and is
 * never re-picked. The claims sync closes that case (apps/sync-worker/src/handlers/
 * claims.ts): it enqueues a CLAIM_CHANGED recompute whenever a claim is created and
 * whenever its return package id or cargo tracking number is filled in, and that
 * recompute reads the already-stored record. An unchanged claim re-scan enqueues nothing,
 * so these triggers must stay in the claims sync's change check.
 *
 * All writes are raw SQL with bound parameters (never string concatenation). The store
 * is one conditional `INSERT ... SELECT ... ON CONFLICT DO UPDATE ... WHERE ... IS
 * DISTINCT FROM`; a bind pass is one `UPDATE ... RETURNING` plus one resolve `SELECT`.
 * `marketplace_finance_records` has no `updated_at` DB trigger, so every write sets it
 * by hand with `clock_timestamp()`. Records are deduplicated on their `(family,
 * record_id)` conflict key before the write, and `transaction_date` binds as
 * `::timestamp(3)` to match the time-zone-less column.
 *
 * Tenant isolation: the INSERT joins the given store filtered by both its id and the
 * caller's organization, so a store that is not this organization's stores nothing; the
 * bind pass filters every statement by both organization and store, and the enqueue
 * re-checks the organization, so another tenant's order can never enter the queue.
 */

/** Only a text of all-digits is a numeric cargo tracking number the index can match. */
const NUMERIC_ID = /^\d+$/;

/**
 * The record columns the order-binding resolve reads: enough to run the same UNION
 * branches whether the caller passes a full `FinanceRecordInput` (ingest) or just the
 * keys a `DELETE ... RETURNING` hands back (prune). `FinanceRecordInput` satisfies it
 * structurally, so the ingest path needs no cast.
 */
type FinanceRecordBindingKey = Pick<
  FinanceRecordInput,
  | 'family'
  | 'transactionType'
  | 'shipmentPackageId'
  | 'paymentOrderId'
  | 'parcelUniqueId'
  | 'orderNumber'
  | 'barcode'
>;

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
    clock_timestamp(),
    true
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
 * The collapsed records are returned sorted by their conflict key (family, then
 * recordId; plain string comparison) so the multi-row `ON CONFLICT DO UPDATE` locks
 * the existing rows in one stable order. Two ingests that share rows would otherwise
 * lock them in opposite orders and deadlock (40P01); the key order is that global order.
 */
function dedupeByConflictKey(records: readonly FinanceRecordInput[]): FinanceRecordInput[] {
  const byKey = new Map<string, FinanceRecordInput>();
  for (const record of records) {
    byKey.set(`${record.family}\u0000${record.recordId}`, record);
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.family !== b.family) return a.family < b.family ? -1 : 1;
    if (a.recordId !== b.recordId) return a.recordId < b.recordId ? -1 : 1;
    return 0;
  });
}

/**
 * Upserts every record on `(store_id, family, record_id)` and flags each inserted or
 * changed row `bind_pending = true`. organization_id and store_id come from the `stores`
 * row (not the caller's raw ids), and the CROSS JOIN matches nothing unless the store
 * belongs to the organization, so a mismatch stores nothing.
 *
 * The conflict update is conditional: its `WHERE ... IS DISTINCT FROM` compares the
 * content columns (not fetched_at/updated_at, which always differ, nor bind_pending), so
 * an unchanged re-poll touches no row -- no rewrite, no dead tuple, no re-flag. Only a
 * row whose content actually changed is updated, re-flagged and counted. Returns the
 * affected row count (inserted + actually changed).
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
    INSERT INTO marketplace_finance_records AS r (
      organization_id, store_id, id, platform, family, transaction_type, record_id,
      invoice_serial, order_number, shipment_package_id, barcode, payment_order_id, parcel_unique_id,
      transaction_date, debt, credit, commission_amount, amount_gross, desi, payload,
      fetched_at, created_at, updated_at, bind_pending
    )
    SELECT s.organization_id, s.id, v.*
    FROM (VALUES ${Prisma.join(valueRows)}) v (
      id, platform, family, transaction_type, record_id,
      invoice_serial, order_number, shipment_package_id, barcode, payment_order_id, parcel_unique_id,
      transaction_date, debt, credit, commission_amount, amount_gross, desi, payload,
      fetched_at, created_at, updated_at, bind_pending
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
      bind_pending = true,
      updated_at = clock_timestamp()
    WHERE (
      r.platform, r.transaction_type, r.invoice_serial, r.order_number,
      r.shipment_package_id, r.barcode, r.payment_order_id, r.parcel_unique_id,
      r.transaction_date, r.debt, r.credit, r.commission_amount, r.amount_gross,
      r.desi, r.payload
    ) IS DISTINCT FROM (
      EXCLUDED.platform, EXCLUDED.transaction_type, EXCLUDED.invoice_serial, EXCLUDED.order_number,
      EXCLUDED.shipment_package_id, EXCLUDED.barcode, EXCLUDED.payment_order_id, EXCLUDED.parcel_unique_id,
      EXCLUDED.transaction_date, EXCLUDED.debt, EXCLUDED.credit, EXCLUDED.commission_amount, EXCLUDED.amount_gross,
      EXCLUDED.desi, EXCLUDED.payload
    )
  `;
}

/** Distinct, non-null text keys of the records in `family` read from `pick`. */
function distinctKeys(
  records: readonly FinanceRecordBindingKey[],
  predicate: (record: FinanceRecordBindingKey) => boolean,
  pick: (record: FinanceRecordBindingKey) => string | null,
): string[] {
  const keys = new Set<string>();
  for (const record of records) {
    if (!predicate(record)) continue;
    const key = pick(record);
    if (key !== null) keys.add(key);
  }
  return [...keys];
}

/** One (orderNumber, barcode) binding pair of a package-less settlement record. */
interface PackagelessPair {
  readonly orderNumber: string;
  readonly barcode: string;
}

/**
 * Distinct (orderNumber, barcode) pairs of the package-less SETTLEMENT records (no
 * shipment package id) whose order number and barcode are both set (non-null and
 * non-empty). These feed the B7 order-number + barcode branch; a record missing either
 * key cannot bind that way.
 */
function distinctPackagelessPairs(records: readonly FinanceRecordBindingKey[]): PackagelessPair[] {
  const byKey = new Map<string, PackagelessPair>();
  for (const record of records) {
    if (record.family !== FinanceRecordFamily.SETTLEMENT) continue;
    if (record.shipmentPackageId !== null) continue;
    const { orderNumber, barcode } = record;
    // An empty order number or barcode is as good as missing: it cannot name a parcel.
    if (orderNumber === null || orderNumber === '' || barcode === null || barcode === '') continue;
    byKey.set(`${orderNumber}\u0000${barcode}`, { orderNumber, barcode });
  }
  return [...byKey.values()];
}

/** Distinct numeric-only cargo tracking numbers (as bigint) among CARGO records. */
function distinctCargoTrackingNumbers(records: readonly FinanceRecordBindingKey[]): bigint[] {
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
 * or a claim's return package; a package-less settlement record (no shipment package
 * id) binds the order whose platform order number and item barcode match the record's
 * order number and barcode; a PaymentOrder record binds the orders tied to this store's
 * stored settlement records carrying that payment order; a cargo item binds the order
 * (or a claim) whose cargo tracking number is its parcel unique id.
 *
 * Each binding is one branch of a `UNION`, so every branch hits an index instead of
 * sharing one `WHERE o.store_id = $s AND (A OR B OR EXISTS ... OR EXISTS ...)` whose
 * OR across correlated subqueries would force a full scan of the store's orders on
 * every batch. Only the branches whose key array is non-empty are built; the `UNION`
 * returns distinct order ids. Every branch filters every table it reads by the store
 * (tenant defense), so another tenant's order can never surface.
 *
 * The package-less branch is deliberately generous: it enqueues every candidate parcel
 * of the order number (no sibling check), because the loader makes the real binding
 * decision and an extra recompute is harmless (an unchanged content hash is a no-op).
 */
async function resolveAffectedOrderIds(
  tx: Prisma.TransactionClient,
  params: { readonly storeId: string; readonly records: readonly FinanceRecordBindingKey[] },
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
  const packagelessPairs = distinctPackagelessPairs(records);

  if (
    shipmentPackageIds.length === 0 &&
    paymentOrderIds.length === 0 &&
    cargoTrackingNumbers.length === 0 &&
    packagelessPairs.length === 0
  ) {
    return [];
  }

  const branches: Prisma.Sql[] = [];
  if (shipmentPackageIds.length > 0) {
    // B1: a settlement row's shipment package is the order's own outbound package.
    branches.push(Prisma.sql`
      SELECT o.id AS "id"
      FROM orders o
      WHERE o.store_id = ${storeId}::uuid
        AND o.platform_order_id = ANY(${shipmentPackageIds}::text[])`);
    // B3: a settlement row's shipment package is a claim's return package.
    branches.push(Prisma.sql`
      SELECT o.id AS "id"
      FROM order_claims c
      JOIN orders o ON o.id = c.order_id AND o.store_id = ${storeId}::uuid
      WHERE c.store_id = ${storeId}::uuid
        AND c.order_shipment_package_id = ANY(${shipmentPackageIds}::text[])`);
  }
  if (cargoTrackingNumbers.length > 0) {
    // B2: a cargo item's parcel id is the order's own cargo tracking number.
    branches.push(Prisma.sql`
      SELECT o.id AS "id"
      FROM orders o
      WHERE o.store_id = ${storeId}::uuid
        AND o.cargo_tracking_number = ANY(${cargoTrackingNumbers}::int8[])`);
    // B4: a cargo item's parcel id is a claim's cargo tracking number.
    branches.push(Prisma.sql`
      SELECT o.id AS "id"
      FROM order_claims c
      JOIN orders o ON o.id = c.order_id AND o.store_id = ${storeId}::uuid
      WHERE c.store_id = ${storeId}::uuid
        AND c.cargo_tracking_number = ANY(${cargoTrackingNumbers}::int8[])`);
  }
  if (paymentOrderIds.length > 0) {
    // B5: a PaymentOrder ties to this store's stored settlement rows whose shipment
    // package is an order's own outbound package.
    branches.push(Prisma.sql`
      SELECT o.id AS "id"
      FROM marketplace_finance_records r
      JOIN orders o ON o.store_id = ${storeId}::uuid AND o.platform_order_id = r.shipment_package_id
      WHERE r.store_id = ${storeId}::uuid
        AND r.family = 'SETTLEMENT'::"FinanceRecordFamily"
        AND r.payment_order_id = ANY(${paymentOrderIds}::text[])`);
    // B6: a PaymentOrder ties to settlement rows whose shipment package is a claim's
    // return package.
    branches.push(Prisma.sql`
      SELECT o.id AS "id"
      FROM marketplace_finance_records r
      JOIN order_claims c2 ON c2.store_id = ${storeId}::uuid AND c2.order_shipment_package_id = r.shipment_package_id
      JOIN orders o ON o.id = c2.order_id AND o.store_id = ${storeId}::uuid
      WHERE r.store_id = ${storeId}::uuid
        AND r.family = 'SETTLEMENT'::"FinanceRecordFamily"
        AND r.payment_order_id = ANY(${paymentOrderIds}::text[])`);
  }
  if (packagelessPairs.length > 0) {
    // B7: a package-less settlement row (no shipment package id) names an order by its
    // (order number, barcode) pair. Any order of the store whose platform_order_number
    // and an item barcode match the PAIR qualifies; the join is on the unnested pair so
    // an order-number of one row never borrows another row's barcode.
    const pairOrderNumbers = packagelessPairs.map((pair) => pair.orderNumber);
    const pairBarcodes = packagelessPairs.map((pair) => pair.barcode);
    branches.push(Prisma.sql`
      SELECT o.id AS "id"
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN unnest(${pairOrderNumbers}::text[], ${pairBarcodes}::text[]) AS k(order_number, barcode)
        ON o.platform_order_number = k.order_number AND oi.barcode = k.barcode
      WHERE o.store_id = ${storeId}::uuid`);
  }

  const rows = await tx.$queryRaw<{ id: string }[]>`${Prisma.join(branches, ' UNION ')}`;
  return rows.map((row) => row.id);
}

/**
 * Phase 1 of the outbox: stores the records idempotently and flags the inserted or
 * changed ones `bind_pending`, so a later `bindPendingFinanceRecords` pass can enqueue
 * their orders after this transaction commits. It does NOT resolve orders or enqueue.
 * An empty records list makes no query. A store/organization mismatch stores nothing.
 * `stored` is the affected row count (inserted + actually changed).
 */
export async function ingestFinanceRecords(
  tx: Prisma.TransactionClient,
  params: {
    readonly organizationId: string;
    readonly storeId: string;
    readonly platform: Platform;
    readonly records: readonly FinanceRecordInput[];
  },
): Promise<{ readonly stored: number }> {
  const { organizationId, storeId, platform } = params;
  if (params.records.length === 0) {
    return { stored: 0 };
  }
  // Collapse same-key repeats before building the VALUES list so one ON CONFLICT write
  // never touches a conflict key twice. `stored` then counts the collapsed rows.
  const records = dedupeByConflictKey(params.records);

  const stored = await storeFinanceRecords(tx, { organizationId, storeId, platform, records });
  return { stored };
}

/** The max pending rows one bind-pass transaction claims and clears at a time. */
const BIND_PASS_BATCH_SIZE = 500;

/** Interactive-transaction budget for one bind pass (Prisma's 5s default is tight for a
 * claim + resolve + enqueue over a busy store). */
const BIND_PASS_TX_MAX_WAIT_MS = 10_000;
const BIND_PASS_TX_TIMEOUT_MS = 30_000;

/**
 * Phase 2 of the outbox: binds the rows an ingest flagged `bind_pending` and enqueues the
 * orders they resolve to, AFTER the ingest transaction that stored them has committed.
 * Runs its own interactive transaction(s) on the root client -- never inside the caller's
 * ingest transaction -- so an order a concurrent sync committed before the pass runs is
 * visible when the bind resolves the flagged rows.
 *
 * Each pass claims up to `BIND_PASS_BATCH_SIZE` of the store's pending rows with
 * `FOR UPDATE SKIP LOCKED`, clears their flag, resolves their orders and enqueues a
 * `FINANCE_RECORD` recompute -- all in one transaction. It repeats while a pass filled a
 * whole batch; a short pass stops (SKIP LOCKED leaves rows another in-flight ingest still
 * holds to that ingest's own bind pass). An empty queue runs one no-op pass and returns.
 *
 * Tenant isolation: every statement is filtered by both organization_id and store_id, and
 * the enqueue re-checks the organization, so another tenant's row can never be bound here.
 */
export async function bindPendingFinanceRecords(
  db: PrismaClient,
  params: { readonly organizationId: string; readonly storeId: string },
): Promise<{ readonly bound: number; readonly enqueuedOrders: number }> {
  const { organizationId, storeId } = params;
  let bound = 0;
  let enqueuedOrders = 0;
  for (;;) {
    const pass = await db.$transaction((tx) => bindPendingPass(tx, { organizationId, storeId }), {
      maxWait: BIND_PASS_TX_MAX_WAIT_MS,
      timeout: BIND_PASS_TX_TIMEOUT_MS,
    });
    bound += pass.bound;
    enqueuedOrders += pass.enqueuedOrders;
    if (pass.bound < BIND_PASS_BATCH_SIZE) {
      break;
    }
  }
  return { bound, enqueuedOrders };
}

/**
 * One bind-pass transaction: claim up to `BIND_PASS_BATCH_SIZE` pending rows of the store
 * (ordered by their `(family, record_id)` key, the same global order the ingest and prune
 * take, so overlapping passes queue instead of deadlocking), clear their flag (every
 * claimed row, resolved or not), and enqueue the orders they bind to. The
 * `UPDATE ... RETURNING` hands the binding keys to
 * the same `resolveAffectedOrderIds` the ingest used to use, so the bound set is identical.
 */
async function bindPendingPass(
  tx: Prisma.TransactionClient,
  params: { readonly organizationId: string; readonly storeId: string },
): Promise<{ readonly bound: number; readonly enqueuedOrders: number }> {
  const { organizationId, storeId } = params;
  const picked = await tx.$queryRaw<FinanceRecordBindingKey[]>`
    WITH picked AS (
      SELECT id
      FROM marketplace_finance_records
      WHERE organization_id = ${organizationId}::uuid
        AND store_id = ${storeId}::uuid
        AND bind_pending
      ORDER BY family, record_id
      LIMIT ${BIND_PASS_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE marketplace_finance_records r
    SET bind_pending = false, updated_at = clock_timestamp()
    FROM picked
    WHERE r.id = picked.id
    RETURNING
      r.family AS "family",
      r.transaction_type AS "transactionType",
      r.shipment_package_id AS "shipmentPackageId",
      r.payment_order_id AS "paymentOrderId",
      r.parcel_unique_id AS "parcelUniqueId",
      r.order_number AS "orderNumber",
      r.barcode AS "barcode"
  `;
  if (picked.length === 0) {
    return { bound: 0, enqueuedOrders: 0 };
  }
  const orderIds = await resolveAffectedOrderIds(tx, { storeId, records: picked });
  const enqueuedOrders = await enqueueProfitRecompute(tx, {
    organizationId,
    storeId,
    reason: ProfitRecomputeReason.FINANCE_RECORD,
    orderIds,
  });
  return { bound: picked.length, enqueuedOrders };
}

/**
 * Prunes the stored finance records of one type that a complete scan no longer
 * returned, then enqueues the orders those deleted rows bound to. Trendyol renews
 * record ids (it did on 3 Aug 2026), and the raw store is keyed by
 * `(store_id, family, record_id)`, so a renewed id lands as a second row and the same
 * sale is counted twice; deleting the rows the scan did not return removes the stale
 * duplicate. The caller only prunes after a scan it has judged complete and in-window.
 *
 * The one `DELETE ... RETURNING` is store- AND organization-scoped (tenant defense),
 * filtered to the single family and transaction type, to rows whose `transaction_date`
 * lies strictly inside the `(windowStart, windowEnd)` open interval, and to rows whose
 * `record_id` the scan did not see. A null `transaction_date` never satisfies the range
 * comparison, so a dateless row is never pruned. An empty `seenRecordIds` deletes every
 * in-window row of that type -- correct, because a complete scan returned none of them.
 * `windowStart >= windowEnd` makes no query and prunes nothing.
 *
 * `CARGO_INVOICE_ITEM` is refused before any query: a cargo item's key is the invoice
 * serial and parcel number, not a renewable Trendyol record id, so it is never pruned.
 *
 * The deleted rows' binding keys feed `resolveAffectedOrderIds` -- the same UNION
 * branches the ingest uses -- and the bound orders are enqueued with the
 * `FINANCE_RECORD` reason so their profit is recomputed without the stale row. The
 * RETURNING clause includes `order_number` and `barcode`, so a pruned package-less row
 * enqueues its order through the order-number + barcode branch too.
 */
export async function pruneUnseenFinanceRecords(
  tx: Prisma.TransactionClient,
  params: {
    readonly organizationId: string;
    readonly storeId: string;
    readonly family: FinanceRecordFamily;
    readonly transactionType: string;
    readonly windowStart: Date; // exclusive
    readonly windowEnd: Date; // exclusive
    readonly seenRecordIds: readonly string[];
  },
): Promise<{ readonly pruned: number; readonly enqueuedOrders: number }> {
  const { organizationId, storeId, family, transactionType, windowStart, windowEnd } = params;
  if (family === FinanceRecordFamily.CARGO_INVOICE_ITEM) {
    throw new Error('pruneUnseenFinanceRecords does not prune CARGO_INVOICE_ITEM rows');
  }
  if (windowStart.getTime() >= windowEnd.getTime()) {
    return { pruned: 0, enqueuedOrders: 0 };
  }
  const seen = [...params.seenRecordIds];

  const deleted = await tx.$queryRaw<FinanceRecordBindingKey[]>`
    DELETE FROM marketplace_finance_records r
    WHERE r.organization_id = ${organizationId}::uuid
      AND r.store_id = ${storeId}::uuid
      AND r.family = ${family}::"FinanceRecordFamily"
      AND r.transaction_type = ${transactionType}::text
      AND r.transaction_date > ${windowStart}::timestamp(3)
      AND r.transaction_date < ${windowEnd}::timestamp(3)
      AND NOT (r.record_id = ANY(${seen}::text[]))
    RETURNING
      r.family AS "family",
      r.transaction_type AS "transactionType",
      r.shipment_package_id AS "shipmentPackageId",
      r.payment_order_id AS "paymentOrderId",
      r.parcel_unique_id AS "parcelUniqueId",
      r.order_number AS "orderNumber",
      r.barcode AS "barcode"
  `;
  if (deleted.length === 0) {
    return { pruned: 0, enqueuedOrders: 0 };
  }

  const orderIds = await resolveAffectedOrderIds(tx, { storeId, records: deleted });
  const enqueuedOrders = await enqueueProfitRecompute(tx, {
    organizationId,
    storeId,
    reason: ProfitRecomputeReason.FINANCE_RECORD,
    orderIds,
  });
  return { pruned: deleted.length, enqueuedOrders };
}
