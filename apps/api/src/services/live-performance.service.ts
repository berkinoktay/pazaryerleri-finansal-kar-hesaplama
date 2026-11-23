import type { Prisma } from '@pazarsync/db';
import { prisma } from '@pazarsync/db';
import { ProfitStatementView, ProfitStatus, type OrderStatus } from '@pazarsync/db/enums';
import type { MappedOrder } from '@pazarsync/marketplace';
import {
  buildCalcCheckLines,
  costDecisionTime,
  itemProfitValues,
  loadOrderProfitLines,
  parseStoredIssues,
  roundPercent,
  selectLines,
} from '@pazarsync/profit';
import { getBusinessDateAnchor, getBusinessDayRange, getBusinessHour } from '@pazarsync/utils';
import Decimal from 'decimal.js';

import { resolveVendorMissingBarcodes } from '../lib/catalog-barcode-miss-lookup';
import { NotFoundError } from '../lib/errors';
import { toPromotionDisplays, type PromotionDisplayWire } from '../lib/promotion-displays';
import { toVariantDesiFields, type VariantDesiFields } from '../validators/product.validator';
import {
  computeParcelProfitForRead,
  logProfitReadFailure,
} from './profit-compute-fallback.service';
import { createRequestFailureLog } from './scenario-screen-commons';

// All "today"/"yesterday" windows come from the single business-timezone helpers
// (packages/utils/src/timezone.ts) — never a hard-coded offset. Orders carry a
// full timestamp, so they filter on the real UTC instant window
// (getBusinessDayRange); the buffer's orderDate is a @db.Date already anchored to
// the business date (getBusinessDateAnchor), so it filters on date equality. Both
// agree with the webhook receiver's gate, so an order buffered as "today" reads
// back as "today" after it graduates to the orders table.

interface DayRange {
  start: Date;
  end: Date;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Aggregate KPI ratio (net profit / denominator * 100), computed and SERVED by
// the backend over the costed subset. This is NOT a render-time per-order margin
// derivation (the rule-violation target removed in Bolum H is the frontend
// computeMargin in order-kpi-grid); the per-order margin in getLiveOrders is read
// straight from the ESTIMATE statement's sale_margin_pct, never recomputed.
// Null when the denominator is zero -- no costed order means no ratio, not a fake 0.
function aggregateRatio(profit: Decimal, denominator: Decimal): string | null {
  if (denominator.isZero()) return null;
  return profit.div(denominator).mul(100).toFixed(2);
}

// The ESTIMATE statement columns live performance reads: the status gates the costed
// subset (decision 10), net profit drives the KPI/chart/feed profit, sale_gross is the
// margin denominator (the sale the profit was computed from, after any return),
// cost_gross is the Kar/Maliyet ratio denominator (replacing the always-null item cost
// snapshots), and sale_margin_pct is the per-order margin the feed surfaces.
const ESTIMATE_STATEMENT_SELECT = {
  status: true,
  netProfit: true,
  saleGross: true,
  costGross: true,
  saleMarginPct: true,
} as const satisfies Prisma.OrderProfitStatementSelect;

type EstimateStatementRow = Prisma.OrderProfitStatementGetPayload<{
  select: typeof ESTIMATE_STATEMENT_SELECT;
}>;

// The relation filter for an order's ESTIMATE statement. Carries organizationId AND
// storeId so a statement filed under another org/store for the same order id is never
// read (tenant isolation); the (order, view) unique leaves at most one matching row.
function estimateStatementWhere(
  orgId: string,
  storeId: string,
): Prisma.OrderProfitStatementWhereInput {
  return { view: ProfitStatementView.ESTIMATE, organizationId: orgId, storeId };
}

/**
 * A costed order's estimate as live performance reads it: the profit, the sale and cost
 * it was computed from (margin and Kar/Maliyet denominators) and the per-order margin.
 * Built from a stored ESTIMATE statement or from an in-request computation.
 */
interface LiveEstimate {
  readonly netProfit: Decimal;
  readonly costGross: Decimal;
  readonly saleGross: Decimal;
  readonly saleMarginPct: Decimal | null;
}

/**
 * The most statement-less orders one live-performance read computes in the request. A
 * statement is normally written seconds after the order, so a handful is the steady
 * state; during a first deploy or a bulk recompute hundreds can be statement-less, and
 * computing them all would stall the page. Past the limit the rest count as pending.
 */
export const LIVE_IN_REQUEST_ESTIMATE_LIMIT = 25;

const LIMIT_REACHED_LOG = '[profit-read] live in-request estimate limit reached';

/**
 * The amounts an estimate statement carries, whether stored (Prisma decimals) or
 * computed in the request (engine decimals); both read through their string form.
 */
interface EstimateStatementAmounts {
  readonly status: ProfitStatus;
  readonly netProfit: { toString(): string } | null;
  readonly costGross: { toString(): string };
  readonly saleGross: { toString(): string };
  readonly saleMarginPct: { toString(): string } | null;
}

/**
 * The live estimate of an estimate statement when it is costed -- ESTIMATED with a
 * non-null net profit (decision 10). Null for a statement that never reached ESTIMATED
 * (NOT_COMPUTABLE / EXCLUDED / CANCELLED). The margin is rounded to the stored column
 * scale (roundPercent), as the writer stores it, so an in-request computation serves
 * the same margin a stored statement would; on a stored value the rounding is a no-op.
 */
function toLiveEstimate(statement: EstimateStatementAmounts): LiveEstimate | null {
  if (statement.status !== ProfitStatus.ESTIMATED || statement.netProfit === null) return null;
  return {
    netProfit: new Decimal(statement.netProfit.toString()),
    costGross: new Decimal(statement.costGross.toString()),
    saleGross: new Decimal(statement.saleGross.toString()),
    saleMarginPct:
      statement.saleMarginPct === null
        ? null
        : roundPercent(new Decimal(statement.saleMarginPct.toString())),
  };
}

/**
 * The costed estimate of each order, keyed by order id; an order is a key only when its
 * profit is known (decision 10). A stored ESTIMATE statement is read as is. An order
 * with no stored statement yet -- the writer runs seconds to minutes after the order --
 * is computed read-only in the request when `computeMissing` is set (owner decision
 * 2026-11-10: today's live page must show a new order's profit at once). Callers pass
 * only non-cancelled orders of this org + store, so the computation stays in the tenant.
 *
 * The computations run one at a time, not in parallel, so a backlog cannot fan out into
 * a burst of connections; at most LIVE_IN_REQUEST_ESTIMATE_LIMIT run per call, the rest
 * stay pending and are logged once. A computation that fails or is not ESTIMATED leaves
 * the order pending; the page still opens (owner decision 2026-11-04). The failures of
 * one call are collected and logged once (`[profit-read]`, with the failed count), so a
 * systemic failure is one line per call, not one per order; an unsupported platform is
 * an expected case and stays pending without a log.
 */
async function resolveLiveEstimates(
  orgId: string,
  storeId: string,
  orders: readonly {
    readonly id: string;
    readonly profitStatements: readonly EstimateStatementRow[];
  }[],
  computeMissing: boolean,
): Promise<ReadonlyMap<string, LiveEstimate>> {
  const estimates = new Map<string, LiveEstimate>();
  const failures = createRequestFailureLog({
    surface: 'live-performance',
    organizationId: orgId,
  });
  let computedCount = 0;
  let skipped = 0;

  for (const order of orders) {
    const stored = order.profitStatements[0];
    if (stored !== undefined) {
      const estimate = toLiveEstimate(stored);
      if (estimate !== null) estimates.set(order.id, estimate);
      continue;
    }
    if (!computeMissing) continue;
    if (computedCount >= LIVE_IN_REQUEST_ESTIMATE_LIMIT) {
      skipped += 1;
      continue;
    }
    computedCount += 1;
    // Sequential on purpose (see above): one computation holds the connection at a time.
    const computed = await computeParcelProfitForRead({
      organizationId: orgId,
      orderId: order.id,
      surface: 'live-performance',
      failures,
    });
    if (computed === null) continue;
    const estimate = toLiveEstimate(computed.estimate);
    if (estimate !== null) estimates.set(order.id, estimate);
  }

  failures.flush();
  if (skipped > 0) {
    console.warn(LIMIT_REACHED_LOG, { organizationId: orgId, storeId, skipped });
  }
  return estimates;
}

// ─── KPIs ───────────────────────────────────────────────────────────────────

export interface KpisResult {
  revenueToday: string;
  revenueYesterday: string;
  orderCountToday: number;
  orderCountYesterday: number;
  unitsSoldToday: number;
  unitsSoldYesterday: number;
  netProfitToday: string;
  // Null when yesterday has no costed order: a zero sum would read as "earned nothing".
  netProfitYesterday: string | null;
  // The ratios are null when their denominator is zero (no costed order).
  marginToday: string | null;
  marginYesterday: string | null;
  profitCostRatioToday: string | null;
  profitCostRatioYesterday: string | null;
  pendingRevenueToday: string;
  pendingOrderCountToday: number;
}

interface OrdersAggregate {
  revenue: Decimal; // universe (all orders in range), the order's own sale
  orderCount: number; // universe
  unitsSold: number; // universe
  netProfit: Decimal; // costed subset
  costedRevenue: Decimal; // costed subset, the statement's sale (margin denominator)
  costedCost: Decimal; // costed subset (Kâr/Maliyet denominator)
  costedCount: number; // costed subset
  pendingRevenue: Decimal; // outside the costed subset, the order's own sale
}

interface BufferAggregate {
  revenue: Decimal;
  orderCount: number;
  unitsSold: number;
}

/**
 * Aggregate the `orders` rows for a day. Volume (revenue / count / units) is over
 * EVERY non-cancelled order; profit / costed-revenue / costed-cost / costed-count are
 * over the costed subset only -- orders whose estimate is ESTIMATED (decision 10),
 * stored or, with `computeMissing`, computed in the request (owner decision
 * 2026-11-10). The costed net, sale and cost all come from that estimate, so the margin
 * divides the profit by the sale it was computed from (after any return); revenue stays
 * the order's own sale_gross, as the seller sees it on the marketplace. Today's
 * cost-missing orders sit in the buffer (not here); yesterday's profit-excluded orders
 * carry an EXCLUDED estimate and so land in volume but never in the costed aggregates.
 */
async function aggregateOrders(
  orgId: string,
  storeId: string,
  range: DayRange,
  computeMissing: boolean,
): Promise<OrdersAggregate> {
  const orders = await prisma.order.findMany({
    where: {
      organizationId: orgId,
      storeId,
      orderDate: { gte: range.start, lt: range.end },
      // Cancels produce no payout — they must not inflate revenue/volume.
      // (Split ghosts are deleted at intake; this also belts any that leak.)
      status: { not: 'CANCELLED' },
    },
    // Newest first, like the feed, so past the in-request limit the KPIs, the chart and
    // the feed compute the same orders; the id breaks an equal-date tie the same way.
    orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      saleGross: true,
      items: { select: { quantity: true } },
      profitStatements: {
        where: estimateStatementWhere(orgId, storeId),
        select: ESTIMATE_STATEMENT_SELECT,
      },
    },
  });
  const estimates = await resolveLiveEstimates(orgId, storeId, orders, computeMissing);

  let revenue = new Decimal(0);
  let unitsSold = 0;
  let netProfit = new Decimal(0);
  let costedRevenue = new Decimal(0);
  let costedCost = new Decimal(0);
  let costedCount = 0;
  let pendingRevenue = new Decimal(0);

  for (const order of orders) {
    const orderRevenue =
      order.saleGross !== null ? new Decimal(order.saleGross.toString()) : new Decimal(0);
    revenue = revenue.add(orderRevenue);
    for (const item of order.items) unitsSold += item.quantity;

    const estimate = estimates.get(order.id);
    if (estimate === undefined) {
      pendingRevenue = pendingRevenue.add(orderRevenue);
      continue;
    }
    netProfit = netProfit.add(estimate.netProfit);
    costedCount += 1;
    costedRevenue = costedRevenue.add(estimate.saleGross);
    costedCost = costedCost.add(estimate.costGross);
  }

  return {
    revenue,
    orderCount: orders.length,
    unitsSold,
    netProfit,
    costedRevenue,
    costedCost,
    costedCount,
    pendingRevenue,
  };
}

/**
 * Aggregate today's buffer (cost-missing orders not yet in `orders`). Revenue +
 * units come from the stored `mappedOrder` JSON — known the moment the order
 * arrives, no cost required. Mirrors the buffer read in `getLiveOrders`.
 */
async function aggregateBuffer(
  orgId: string,
  storeId: string,
  anchor: Date,
): Promise<BufferAggregate> {
  const rows = await prisma.livePerformanceBuffer.findMany({
    where: { organizationId: orgId, storeId, orderDate: anchor },
    select: { mappedOrder: true },
  });

  let revenue = new Decimal(0);
  let unitsSold = 0;
  for (const entry of rows) {
    const mapped = entry.mappedOrder as unknown as MappedOrder;
    revenue = revenue.add(mapped.saleGross);
    for (const line of mapped.lines) unitsSold += line.quantity;
  }
  return { revenue, orderCount: rows.length, unitsSold };
}

export async function getKpis(args: { orgId: string; storeId: string }): Promise<KpisResult> {
  const today = getBusinessDayRange();
  const yesterday = getBusinessDayRange(new Date(Date.now() - ONE_DAY_MS));
  const todayAnchor = getBusinessDateAnchor();

  // Yesterday never unions the buffer — its uncosted orders were graduated into
  // `orders` as PROFIT-EXCLUDED at midnight, so `orders` is already complete. Only today
  // computes a statement-less order in the request: computing yesterday too would add
  // to every page open. Normally yesterday's statements are long written, but a first
  // deploy's recompute backlog can take hours; in that window a statement-less order of
  // yesterday counts toward volume and not toward profit (yesterday's profit misses that order),
  // and the next write of its statement corrects it.
  const [todayOrders, todayBuffer, yesterdayOrders] = await Promise.all([
    aggregateOrders(args.orgId, args.storeId, today, true),
    aggregateBuffer(args.orgId, args.storeId, todayAnchor),
    aggregateOrders(args.orgId, args.storeId, yesterday, false),
  ]);

  const todayRevenue = todayOrders.revenue.add(todayBuffer.revenue);
  const todayCount = todayOrders.orderCount + todayBuffer.orderCount;
  const todayUnits = todayOrders.unitsSold + todayBuffer.unitsSold;

  return {
    revenueToday: todayRevenue.toFixed(2),
    revenueYesterday: yesterdayOrders.revenue.toFixed(2),
    orderCountToday: todayCount,
    orderCountYesterday: yesterdayOrders.orderCount,
    unitsSoldToday: todayUnits,
    unitsSoldYesterday: yesterdayOrders.unitsSold,
    netProfitToday: todayOrders.netProfit.toFixed(2),
    netProfitYesterday:
      yesterdayOrders.costedCount === 0 ? null : yesterdayOrders.netProfit.toFixed(2),
    marginToday: aggregateRatio(todayOrders.netProfit, todayOrders.costedRevenue),
    marginYesterday: aggregateRatio(yesterdayOrders.netProfit, yesterdayOrders.costedRevenue),
    profitCostRatioToday: aggregateRatio(todayOrders.netProfit, todayOrders.costedCost),
    profitCostRatioYesterday: aggregateRatio(yesterdayOrders.netProfit, yesterdayOrders.costedCost),
    // The pending gap is the order's own sale of every uncosted order (orders + buffer),
    // not universe minus the costed statements' sale, which a return would skew.
    pendingRevenueToday: todayOrders.pendingRevenue.add(todayBuffer.revenue).toFixed(2),
    pendingOrderCountToday: todayCount - todayOrders.costedCount,
  };
}

// ─── Chart ────────────────────────────────────────────────────────────────────

export interface ChartPoint {
  hour: number;
  cumulativeRevenue: string;
  cumulativeProfit: string;
}

export interface ChartResult {
  today: ChartPoint[];
  yesterday: ChartPoint[];
}

const HOURS_IN_DAY = 24;

/**
 * Hourly cumulative revenue + profit for a business day. Revenue buckets EVERY
 * order's subtotal (plus the buffer, today only); profit buckets the costed
 * subset -- the costed estimate's net, by order hour (decision 10), stored or, with
 * `computeMissing`, computed in the request (owner decision 2026-11-10). The two running
 * totals drive the front-end's ciro<->kar toggle without a second request.
 */
async function hourlyCumulative(
  orgId: string,
  storeId: string,
  range: DayRange,
  bufferAnchor: Date | null,
  computeMissing: boolean,
): Promise<ChartPoint[]> {
  const orders = await prisma.order.findMany({
    where: {
      organizationId: orgId,
      storeId,
      orderDate: { gte: range.start, lt: range.end },
      // Mirrors aggregateOrders — cancelled orders carry no payout.
      status: { not: 'CANCELLED' },
    },
    // Mirrors aggregateOrders -- the same orders are computed past the in-request limit.
    orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      orderDate: true,
      saleGross: true,
      profitStatements: {
        where: estimateStatementWhere(orgId, storeId),
        select: ESTIMATE_STATEMENT_SELECT,
      },
    },
  });
  const estimates = await resolveLiveEstimates(orgId, storeId, orders, computeMissing);

  const revenueBuckets = Array.from({ length: HOURS_IN_DAY }, () => new Decimal(0));
  const profitBuckets = Array.from({ length: HOURS_IN_DAY }, () => new Decimal(0));

  for (const order of orders) {
    const hour = getBusinessHour(order.orderDate);
    if (order.saleGross !== null)
      revenueBuckets[hour] = (revenueBuckets[hour] ?? new Decimal(0)).add(
        order.saleGross.toString(),
      );
    const estimate = estimates.get(order.id);
    if (estimate !== undefined)
      profitBuckets[hour] = (profitBuckets[hour] ?? new Decimal(0)).add(estimate.netProfit);
  }

  if (bufferAnchor !== null) {
    const bufferRows = await prisma.livePerformanceBuffer.findMany({
      where: { organizationId: orgId, storeId, orderDate: bufferAnchor },
      select: { mappedOrder: true },
    });
    for (const entry of bufferRows) {
      const mapped = entry.mappedOrder as unknown as MappedOrder;
      const hour = getBusinessHour(new Date(mapped.orderDate));
      revenueBuckets[hour] = (revenueBuckets[hour] ?? new Decimal(0)).add(mapped.saleGross);
    }
  }

  let runningRevenue = new Decimal(0);
  let runningProfit = new Decimal(0);
  return revenueBuckets.map((revenueBucket, hour) => {
    runningRevenue = runningRevenue.add(revenueBucket);
    runningProfit = runningProfit.add(profitBuckets[hour] ?? new Decimal(0));
    return {
      hour,
      cumulativeRevenue: runningRevenue.toFixed(2),
      cumulativeProfit: runningProfit.toFixed(2),
    };
  });
}

export async function getChart(args: { orgId: string; storeId: string }): Promise<ChartResult> {
  const today = getBusinessDayRange();
  const yesterday = getBusinessDayRange(new Date(Date.now() - ONE_DAY_MS));
  const todayAnchor = getBusinessDateAnchor();

  // Only today computes a statement-less order in the request (see getKpis).
  const [todayPoints, yesterdayPoints] = await Promise.all([
    hourlyCumulative(args.orgId, args.storeId, today, todayAnchor, true),
    hourlyCumulative(args.orgId, args.storeId, yesterday, null, false),
  ]);

  return { today: todayPoints, yesterday: yesterdayPoints };
}

// ─── Today's Products (orders ∪ today buffer, per barcode) ──────────────────────

/**
 * The desi fields of a row whose barcode resolves to no catalog variant: no desi to
 * show and nothing the seller can fill in, so it is never counted as missing desi.
 */
const UNRESOLVED_DESI_FIELDS = {
  dimensionalWeight: null,
  syncedDimensionalWeight: null,
  isDimensionalWeightOverridden: false,
  isDimensionalWeightMissing: false,
} as const satisfies VariantDesiFields;

/**
 * The desi fields (VariantDesiFields) come from toVariantDesiFields, the products
 * list's own rule, or UNRESOLVED_DESI_FIELDS on an unresolved row.
 */
export interface TodayProductRow extends VariantDesiFields {
  /** Null on an unresolved row — the barcode has no catalog variant (yet). */
  variantId: string | null;
  barcode: string;
  stockCode: string | null;
  productName: string | null;
  thumbUrl: string | null;
  orderCount: number;
  unitsSold: number;
  revenue: string;
  costStatus: 'costed' | 'missing';
  unitCost: string | null;
  /** Barcode resolves to no catalog variant — identity falls back to the raw
   *  barcode; rare after eager repair (spec 2026-06-12 §7). */
  unresolved: boolean;
  /** Unresolved barcode is a CONFIRMED catalog gap (CatalogBarcodeMiss with
   *  vendorMissing=true) — the seller sees "Trendyol kataloğunda yok" rather
   *  than "eşleşme bekliyor". Only meaningful for unresolved rows; always false
   *  for resolved ones. Backend-derived; the frontend never computes it. */
  vendorMissing: boolean;
}

/**
 * An order item whose cost lines can back a variant's displayed unit cost: one of today's
 * order items selling the variant whose order carries a stored ESTIMATE statement.
 * `issues` are that statement's stored issues.
 */
interface ChosenOrderItem {
  orderId: string;
  itemId: string;
  quantity: number;
  orderDate: Date;
  issues: Prisma.JsonValue;
}

interface ProductAccumulator {
  variantId: string | null;
  barcode: string;
  stockCode: string | null;
  productName: string | null;
  thumbUrl: string | null;
  orderIds: Set<string>; // distinct orders (orders table) containing this variant
  bufferEntryCount: number; // distinct buffer entries containing this barcode
  unitsSold: number;
  revenue: Decimal;
  // The earliest (order date, then item id) item whose order's ESTIMATE statement is
  // ESTIMATED -- the preferred source of the displayed unit cost; null until one exists.
  estimatedItem: ChosenOrderItem | null;
  // The earliest item whose order carries ANY ESTIMATE statement -- the fallback used
  // only when no ESTIMATED one exists, so a not-yet-estimated order still shows a cost.
  anyStatementItem: ChosenOrderItem | null;
  unresolved: boolean;
  desi: VariantDesiFields;
}

/**
 * The item backing a variant's displayed unit cost: the earliest item whose ESTIMATE
 * statement is ESTIMATED if any, else the earliest item with any ESTIMATE statement,
 * else null (unit cost stays null).
 */
function chosenItemOf(acc: ProductAccumulator): ChosenOrderItem | null {
  return acc.estimatedItem ?? acc.anyStatementItem;
}

/** Order-by for the chosen item: earliest order date, then lowest item id. */
function isEarlierChosenItem(candidate: ChosenOrderItem, current: ChosenOrderItem): boolean {
  const byDate = candidate.orderDate.getTime() - current.orderDate.getTime();
  if (byDate !== 0) return byDate < 0;
  return candidate.itemId < current.itemId;
}

/**
 * The displayed unit cost for each variant's chosen order item, keyed by that item's id.
 * Loads the chosen orders' stored profit lines once, then runs itemProfitValues per
 * chosen item -- itemProfitValues' unitCostGross over the item's view-selected lines.
 * Rebuilding engine values from stored rows throws on a corrupt row (malformed line
 * inputs/issues, a level conflict); that must not take the whole day down, so on any
 * failure this logs at error level and returns an empty map, leaving every row with a
 * null unit cost (owner decision 2026-11-04). Tenant-scoped by organizationId + storeId.
 */
async function deriveUnitCostByItem(
  orgId: string,
  storeId: string,
  chosenItems: readonly ChosenOrderItem[],
): Promise<ReadonlyMap<string, string | null>> {
  if (chosenItems.length === 0) {
    return new Map();
  }
  try {
    const orderIds = [...new Set(chosenItems.map((item) => item.orderId))];
    const linesByOrder = await loadOrderProfitLines(prisma, {
      organizationId: orgId,
      storeId,
      orderIds,
    });
    const unitCostByItem = new Map<string, string | null>();
    for (const chosen of chosenItems) {
      const lines = linesByOrder.get(chosen.orderId) ?? [];
      unitCostByItem.set(
        chosen.itemId,
        itemProfitValues({
          orderItemId: chosen.itemId,
          quantity: chosen.quantity,
          bestKnownLines: selectLines(lines, 'BEST_KNOWN'),
          estimateLines: selectLines(lines, 'ESTIMATE'),
          issues: parseStoredIssues(chosen.issues),
        }).unitCostGross,
      );
    }
    return unitCostByItem;
  } catch (err) {
    logProfitReadFailure({ surface: 'today-products', organizationId: orgId, orderId: null, err });
    return new Map();
  }
}

interface VariantIdentity {
  /** Accumulator map key: variant uuid, or `barcode:<code>` for the fallback. */
  id: string;
  variantId: string | null;
  barcode: string;
  stockCode: string | null;
  productName: string | null;
  thumbUrl: string | null;
  unresolved: boolean;
  desi: VariantDesiFields;
}

// The catalog fields a today-products row shows for a variant, read both through an
// order item's variant link and through the barcode lookup, so both give one shape.
const ROW_VARIANT_SELECT = {
  id: true,
  barcode: true,
  stockCode: true,
  dimensionalWeightOverride: true,
  syncedDimensionalWeight: true,
  isDigital: true,
  product: {
    select: {
      title: true,
      imageUrls: true,
    },
  },
} as const satisfies Prisma.ProductVariantSelect;

type LookedUpVariant = Prisma.ProductVariantGetPayload<{ select: typeof ROW_VARIANT_SELECT }>;

/** A catalog variant's own row identity. */
function variantIdentity(variant: LookedUpVariant): VariantIdentity {
  return {
    id: variant.id,
    variantId: variant.id,
    barcode: variant.barcode,
    stockCode: variant.stockCode,
    productName: variant.product.title,
    thumbUrl: variant.product.imageUrls[0] ?? null,
    unresolved: false,
    desi: toVariantDesiFields(variant),
  };
}

/**
 * The row identity of a barcode read without a variant link (a buffer line, or an order
 * line whose variant was deleted or never linked): the variant the store's barcode lookup
 * resolved for it, else the barcode fallback (an unresolved row keyed `barcode:<code>`).
 * Both sources go through this one function, so a buffer line and a variantless order
 * line of one barcode land on the same row, and a re-created variant merges into the row
 * of its linked order lines.
 */
function identityForBarcode(
  barcode: string,
  variantByBarcode: ReadonlyMap<string, LookedUpVariant>,
): VariantIdentity {
  const variant = variantByBarcode.get(barcode);
  if (variant !== undefined) return variantIdentity(variant);
  return {
    id: `barcode:${barcode}`,
    variantId: null,
    barcode,
    stockCode: null,
    productName: null,
    thumbUrl: null,
    unresolved: true,
    desi: UNRESOLVED_DESI_FIELDS,
  };
}

/**
 * One row per product variant that sold today, merged over the universe:
 * `orders`(today) ∪ `buffer`(today). Volume (orderCount / unitsSold / revenue) is
 * known the moment the order arrives — no cost required. costStatus is resolved
 * from the active ProductVariantCostProfile (authoritative; matches the retired
 * getMissingCost), and the displayed unitCost is itemProfitValues' unit cost for the
 * variant's preferred today order item -- the earliest whose ESTIMATE statement is
 * ESTIMATED, else the earliest with any ESTIMATE statement (decision 10) -- derived from
 * that order's cost lines, not a legacy snapshot column. A corrupt stored line must not
 * take the whole day down: on any unit-cost derivation failure the list is returned with
 * a null unitCost on every row and the error is logged (owner decision 2026-11-04);
 * volumes and cost status stand. There is NO per-product profit (an order's net profit
 * can't be cleanly attributed to one line). Rows are returned sorted by unitsSold desc
 * for deterministic output; the frontend owns the live re-sort. An order line without a
 * variant (deleted or never linked) is not dropped: it is shown by its barcode, resolved
 * like a buffer line (identityForBarcode); a line with neither is skipped.
 */
export async function getTodayProducts(args: {
  orgId: string;
  storeId: string;
}): Promise<TodayProductRow[]> {
  const { start, end } = getBusinessDayRange();
  const todayAnchor = getBusinessDateAnchor();

  const [orderItems, bufferRows] = await Promise.all([
    // Every non-cancelled line of today's orders, with or without a variant link: a line
    // whose variant was deleted (FK SET NULL) or never linked is shown by its barcode.
    prisma.orderItem.findMany({
      where: {
        order: {
          organizationId: args.orgId,
          storeId: args.storeId,
          orderDate: { gte: start, lt: end },
          // Mirrors aggregateOrders — cancelled orders carry no payout.
          status: { not: 'CANCELLED' },
        },
      },
      select: {
        id: true,
        orderId: true,
        quantity: true,
        lineSaleGross: true,
        // The line's own barcode names a variantless line's row.
        barcode: true,
        // The order date orders the candidates; the ESTIMATE statement's status picks
        // the preferred item (ESTIMATED over any), and its issues feed itemProfitValues.
        order: {
          select: {
            orderDate: true,
            profitStatements: {
              where: estimateStatementWhere(args.orgId, args.storeId),
              select: { status: true, issues: true },
            },
          },
        },
        productVariant: { select: ROW_VARIANT_SELECT },
      },
    }),
    // No status filter (unlike getMissingCost, which is PENDING-only because it's
    // the actionable "add cost now" list): every buffered sale counts toward volume
    // regardless of promote state. Mirrors aggregateBuffer / getLiveOrders.
    prisma.livePerformanceBuffer.findMany({
      where: { organizationId: args.orgId, storeId: args.storeId, orderDate: todayAnchor },
      select: { id: true, mappedOrder: true },
    }),
  ]);

  const byVariant = new Map<string, ProductAccumulator>();
  const ensure = (identity: VariantIdentity): ProductAccumulator => {
    const existing = byVariant.get(identity.id);
    if (existing !== undefined) return existing;
    const created: ProductAccumulator = {
      variantId: identity.variantId,
      barcode: identity.barcode,
      stockCode: identity.stockCode,
      productName: identity.productName,
      thumbUrl: identity.thumbUrl,
      orderIds: new Set<string>(),
      bufferEntryCount: 0,
      unitsSold: 0,
      revenue: new Decimal(0),
      estimatedItem: null,
      anyStatementItem: null,
      unresolved: identity.unresolved,
      desi: identity.desi,
    };
    byVariant.set(identity.id, created);
    return created;
  };

  type TodayOrderItem = (typeof orderItems)[number];

  // Adds one of today's order lines to its row: its order, units and revenue, and the
  // line as a candidate for the row's displayed unit cost. Linked and variantless lines
  // both go through it, so a merged row follows one rule.
  const addOrderItem = (acc: ProductAccumulator, item: TodayOrderItem): void => {
    acc.orderIds.add(item.orderId);
    acc.unitsSold += item.quantity;
    // lineSaleGross is the LINE total (KDV-dahil, already × quantity) — add directly.
    acc.revenue = acc.revenue.add(item.lineSaleGross.toString());
    // Track the preferred item whose cost lines back the displayed unit cost below: any
    // ESTIMATE statement feeds the fallback, an ESTIMATED one also the preferred choice.
    // Both keep the earliest (order date, then item id) candidate.
    const estimateStatement = item.order.profitStatements[0];
    if (estimateStatement !== undefined) {
      const candidate: ChosenOrderItem = {
        orderId: item.orderId,
        itemId: item.id,
        quantity: item.quantity,
        orderDate: item.order.orderDate,
        issues: estimateStatement.issues,
      };
      if (acc.anyStatementItem === null || isEarlierChosenItem(candidate, acc.anyStatementItem)) {
        acc.anyStatementItem = candidate;
      }
      if (
        estimateStatement.status === ProfitStatus.ESTIMATED &&
        (acc.estimatedItem === null || isEarlierChosenItem(candidate, acc.estimatedItem))
      ) {
        acc.estimatedItem = candidate;
      }
    }
  };

  // Orders: a linked line takes its identity from its variant. A variantless line (its
  // variant was deleted, or it was never linked) is held by its barcode and resolved
  // below through the same barcode lookup as the buffer lines.
  const orphanItemsByBarcode = new Map<string, TodayOrderItem[]>();
  for (const item of orderItems) {
    if (item.productVariant !== null) {
      addOrderItem(ensure(variantIdentity(item.productVariant)), item);
      continue;
    }
    // Neither a variant nor a barcode: nothing names the row (the row schema requires a
    // barcode), so the line is skipped.
    if (item.barcode === null) continue;
    const orphanItems = orphanItemsByBarcode.get(item.barcode) ?? [];
    orphanItems.push(item);
    orphanItemsByBarcode.set(item.barcode, orphanItems);
  }

  // Buffer: aggregate lines by barcode (the entry carries no variant id). These barcodes
  // and the variantless order lines' barcodes resolve through the one organization +
  // store barcode lookup below.
  interface BufferBarcodeAggregate {
    units: number;
    revenue: Decimal;
    entryIds: Set<string>;
  }
  const bufferByBarcode = new Map<string, BufferBarcodeAggregate>();
  for (const entry of bufferRows) {
    const mapped = entry.mappedOrder as unknown as MappedOrder;
    for (const line of mapped.lines) {
      const agg = bufferByBarcode.get(line.barcode) ?? {
        units: 0,
        revenue: new Decimal(0),
        entryIds: new Set<string>(),
      };
      agg.units += line.quantity;
      // lineSaleGross is the LINE total (KDV-dahil, already × quantity) — add directly.
      agg.revenue = agg.revenue.add(line.lineSaleGross);
      agg.entryIds.add(entry.id);
      bufferByBarcode.set(line.barcode, agg);
    }
  }

  // One batched barcode lookup for the buffer lines and the variantless order lines,
  // scoped by organizationId + storeId (no N+1).
  const lookupBarcodes = [...new Set([...bufferByBarcode.keys(), ...orphanItemsByBarcode.keys()])];
  const lookedUpVariants =
    lookupBarcodes.length > 0
      ? await prisma.productVariant.findMany({
          where: {
            storeId: args.storeId,
            organizationId: args.orgId,
            barcode: { in: lookupBarcodes },
          },
          // Deterministic first match per barcode (lowest variant id), mirrored by
          // the calculability gate (buildCalcCheckLines) and findFirstVariantByBarcode.
          orderBy: { id: 'asc' },
          select: ROW_VARIANT_SELECT,
        })
      : [];
  // First match per barcode, as the calculability gate (buildCalcCheckLines) resolves
  // it, so a barcode shared by two variants shows the variant the gate holds the order for.
  const variantByBarcode = new Map<string, LookedUpVariant>();
  for (const variant of lookedUpVariants) {
    if (!variantByBarcode.has(variant.barcode)) variantByBarcode.set(variant.barcode, variant);
  }

  for (const [barcode, agg] of bufferByBarcode) {
    // Çözülemeyen barkod DÜŞÜRÜLMEZ (görünürlük sözleşmesi, spec 2026-06-12
    // §7): satıcı "1 sipariş var ama ürün listesi boş" tutarsızlığını asla
    // görmez. Eager onarım (PR-2) sayesinde bu satır nadir istisnadır.
    const acc = ensure(identityForBarcode(barcode, variantByBarcode));
    acc.bufferEntryCount += agg.entryIds.size;
    acc.unitsSold += agg.units;
    acc.revenue = acc.revenue.add(agg.revenue);
  }

  // Variantless order lines, through the same identity as the buffer lines: a barcode the
  // lookup resolves merges into that variant's row, an unknown one into the buffer's
  // unresolved row of that barcode (or its own). An unresolved row's cost status stays
  // 'missing', as for every unresolved row.
  for (const [barcode, items] of orphanItemsByBarcode) {
    const acc = ensure(identityForBarcode(barcode, variantByBarcode));
    for (const item of items) addOrderItem(acc, item);
  }

  // Cost status: a variant is costed iff it has an active (non-archived) cost
  // profile — authoritative, independent of buffer/orders presence. Fallback
  // rows carry no variant id (their map key is `barcode:`-prefixed) and can
  // never enter the costed set — costStatus is always 'missing' for them.
  const variantIds = [...byVariant.values()].flatMap((acc) =>
    acc.variantId === null ? [] : [acc.variantId],
  );
  const costedVariantIds = new Set(
    (variantIds.length > 0
      ? await prisma.productVariantCostProfile.findMany({
          where: {
            productVariantId: { in: variantIds },
            organizationId: args.orgId,
            profile: { archivedAt: null },
          },
          select: { productVariantId: true },
        })
      : []
    ).map((link) => link.productVariantId),
  );

  // vendorMissing: an unresolved barcode that is a confirmed catalog gap
  // (CatalogBarcodeMiss with vendorMissing=true) drives the "Trendyol
  // kataloğunda yok" badge. Backend-derived; one batched query over the
  // distinct unresolved barcodes — no N+1. Resolved rows are always false.
  const vendorMissingBarcodes = await resolveVendorMissingBarcodes(
    args.orgId,
    args.storeId,
    [...byVariant.values()].flatMap((acc) => (acc.variantId === null ? [acc.barcode] : [])),
  );

  // The chosen items' unit costs, derived in one batched read of their orders' cost
  // lines (decision 10). A corrupt stored line leaves every unit cost null but never
  // 500s the day. Tenant-scoped by organizationId + storeId.
  const chosenItems = [...byVariant.values()].flatMap((acc) => {
    const chosen = chosenItemOf(acc);
    return chosen === null ? [] : [chosen];
  });
  const unitCostByItem = await deriveUnitCostByItem(args.orgId, args.storeId, chosenItems);

  return [...byVariant.values()]
    .map((acc) => {
      const costed = acc.variantId !== null && costedVariantIds.has(acc.variantId);
      // Unit cost: the chosen item's derived unit cost; null when no order with a stored
      // ESTIMATE statement sold this variant today, or when the derivation failed above.
      const chosen = chosenItemOf(acc);
      const unitCost = chosen === null ? null : (unitCostByItem.get(chosen.itemId) ?? null);
      const row: TodayProductRow = {
        variantId: acc.variantId,
        barcode: acc.barcode,
        stockCode: acc.stockCode,
        productName: acc.productName,
        thumbUrl: acc.thumbUrl,
        orderCount: acc.orderIds.size + acc.bufferEntryCount,
        unitsSold: acc.unitsSold,
        revenue: acc.revenue.toFixed(2),
        costStatus: costed ? 'costed' : 'missing',
        unitCost,
        unresolved: acc.unresolved,
        vendorMissing: acc.variantId === null && vendorMissingBarcodes.has(acc.barcode),
        ...acc.desi,
      };
      // Retain the Decimal revenue for the tiebreaker so the sort compares
      // numerically, not lexicographically over the `.toFixed(2)` string.
      return { row, units: acc.unitsSold, revenue: acc.revenue };
    })
    .sort((a, b) => b.units - a.units || b.revenue.cmp(a.revenue))
    .map((entry) => entry.row);
}

// ─── Orders (today orders + today buffer) ──────────────────────────────────────

export interface LiveOrderRow {
  source: 'orders' | 'buffer';
  platformOrderId: string;
  platformOrderNumber: string | null;
  orderId: string | null;
  bufferId: string | null;
  orderDate: string;
  status: string;
  revenue: string;
  profit: string | null;
  margin: string | null;
  promotionDisplays: PromotionDisplayWire[] | null;
}

export interface LiveOrdersResult {
  data: LiveOrderRow[];
  total: number;
  counts: { all: number; calculated: number; pending: number };
}

export async function getLiveOrders(args: {
  orgId: string;
  storeId: string;
  filter?: 'all' | 'calculated' | 'pending';
}): Promise<LiveOrdersResult> {
  const { start, end } = getBusinessDayRange();
  const todayAnchor = getBusinessDateAnchor();
  const filter = args.filter ?? 'all';

  const [ordersToday, bufferRows] = await Promise.all([
    prisma.order.findMany({
      where: {
        organizationId: args.orgId,
        storeId: args.storeId,
        orderDate: { gte: start, lt: end },
        // Mirrors aggregateOrders — the live feed shows earnings, not cancels.
        status: { not: 'CANCELLED' },
      },
      // Mirrors aggregateOrders -- the same orders are computed past the in-request limit.
      orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        platformOrderId: true,
        platformOrderNumber: true,
        orderDate: true,
        status: true,
        saleGross: true,
        // Profit + margin come from the order's ESTIMATE statement (decision 10) --
        // render-time hesap yok (kural: backend servis eder).
        profitStatements: {
          where: estimateStatementWhere(args.orgId, args.storeId),
          select: ESTIMATE_STATEMENT_SELECT,
        },
        // Promosyon adları (spec ekleme #3) — liste detayıyla aynı JSON kolonu.
        promotionDisplays: true,
      },
    }),
    prisma.livePerformanceBuffer.findMany({
      where: { organizationId: args.orgId, storeId: args.storeId, orderDate: todayAnchor },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        platformOrderId: true,
        platformOrderNumber: true,
        orderDate: true,
        mappedOrder: true,
      },
    }),
  ]);

  // Profit + margin come from the order's costed estimate (decision 10): the stored
  // ESTIMATE statement, or an in-request computation while the writer catches up (owner
  // decision 2026-11-10) -- render-time recompute YOK. An order without one is listed
  // under pending, so the tab counts match the KPIs' costed subset.
  const estimates = await resolveLiveEstimates(args.orgId, args.storeId, ordersToday, true);
  const calculatedRows: LiveOrderRow[] = [];
  const uncostedOrderRows: LiveOrderRow[] = [];
  for (const order of ordersToday) {
    const revenue =
      order.saleGross !== null ? new Decimal(order.saleGross.toString()) : new Decimal(0);
    const estimate = estimates.get(order.id);
    const row: LiveOrderRow = {
      source: 'orders',
      platformOrderId: order.platformOrderId,
      platformOrderNumber: order.platformOrderNumber,
      orderId: order.id,
      bufferId: null,
      orderDate: order.orderDate.toISOString(),
      status: order.status,
      revenue: revenue.toFixed(2),
      profit: estimate !== undefined ? estimate.netProfit.toFixed(2) : null,
      margin:
        estimate !== undefined && estimate.saleMarginPct !== null
          ? estimate.saleMarginPct.toFixed(2)
          : null,
      // Promosyon adları liste detayıyla aynı runtime-doğrulamalı dönüşümden geçer.
      promotionDisplays: toPromotionDisplays(order.promotionDisplays),
    };
    if (estimate === undefined) {
      uncostedOrderRows.push(row);
    } else {
      calculatedRows.push(row);
    }
  }

  const bufferPendingRows: LiveOrderRow[] = bufferRows.map((entry) => {
    const mapped = entry.mappedOrder as unknown as MappedOrder;
    return {
      source: 'buffer',
      platformOrderId: entry.platformOrderId,
      platformOrderNumber: entry.platformOrderNumber,
      orderId: null,
      bufferId: entry.id,
      // The real order timestamp (hour-level) lives in the mapped payload; the
      // buffer's own `orderDate` column is date-only (midnight), which would
      // render every pending row at the same wrong "03:00".
      orderDate: new Date(mapped.orderDate).toISOString(),
      status: mapped.status,
      revenue: new Decimal(mapped.saleGross).toFixed(2),
      profit: null,
      margin: null,
      // Buffer satırı henüz Order'a dönüşmedi → promosyon JSON'u yok.
      promotionDisplays: null,
    };
  });

  const newestFirst = (a: LiveOrderRow, b: LiveOrderRow): number =>
    b.orderDate.localeCompare(a.orderDate);
  const pendingRows = [...uncostedOrderRows, ...bufferPendingRows].sort(newestFirst);
  const dataByFilter: Record<typeof filter, LiveOrderRow[]> = {
    all: [...calculatedRows, ...pendingRows].sort(newestFirst),
    calculated: calculatedRows,
    pending: pendingRows,
  };
  const data = dataByFilter[filter];

  return {
    data,
    total: data.length,
    counts: {
      all: calculatedRows.length + pendingRows.length,
      calculated: calculatedRows.length,
      pending: pendingRows.length,
    },
  };
}

export interface NewOrderNotificationSummary {
  source: 'orders' | 'buffer';
  orderId: string | null;
  bufferId: string | null;
  platformOrderNumber: string | null;
  revenue: string;
  profit: string | null;
  costStatus: 'costed' | 'pending';
  isToday: boolean;
  // Order lifecycle status for source='orders'; null for buffer (not yet an
  // order). Lets the client drop a toast for a CANCELLED / first-seen-RETURNED
  // order that the summary endpoint would otherwise announce.
  status: OrderStatus | null;
  // True only when an order graduated from the live-performance buffer; always
  // false for buffer entries. Suppresses a duplicate ding for an already-seen order.
  isPromotion: boolean;
}

// --- Buffer Detail ---

export interface BufferDetailLine extends VariantDesiFields {
  barcode: string;
  productName: string;
  thumbUrl: string | null;
  variantId: string | null;
  stockCode: string | null;
  quantity: number;
  // GROSS konvansiyon (2026-06-16): lineSaleGross satır toplamı (KDV-dahil, × quantity).
  lineSaleGross: string;
  /**
   * The line's gap in the calculability gate that holds the order in the buffer
   * (buildCalcCheckLines): no cost profile link in force at the order's business-day
   * end (none linked, or every linked profile archived), or the barcode resolves to
   * no variant. Deliberately the gate's own check, not the products page's
   * active-profile rule, so it names exactly what keeps this order waiting.
   */
  isCostMissing: boolean;
}

export interface BufferDetail {
  platformOrderNumber: string | null;
  orderDate: string; // ISO
  status: string;
  saleGross: string;
  lines: BufferDetailLine[];
}

export async function getBufferDetail(args: {
  orgId: string;
  storeId: string;
  bufferId: string;
}): Promise<BufferDetail> {
  const entry = await prisma.livePerformanceBuffer.findFirst({
    where: { id: args.bufferId, organizationId: args.orgId, storeId: args.storeId },
    select: {
      id: true,
      platformOrderNumber: true,
      orderDate: true,
      mappedOrder: true,
    },
  });
  if (entry === null) {
    throw new NotFoundError('BufferEntry', args.bufferId);
  }

  const mapped = entry.mappedOrder as unknown as MappedOrder;
  // The mapped order's own instant when it holds a valid date (the JSONB round-trip
  // leaves it an ISO string); else the row's business-day anchor, so a row with a
  // missing or broken date still opens.
  const orderDate = parseMappedOrderDate(mapped.orderDate) ?? entry.orderDate;

  const barcodes = [...new Set(mapped.lines.map((l) => l.barcode))];
  const variants =
    barcodes.length > 0
      ? await prisma.productVariant.findMany({
          where: { storeId: args.storeId, organizationId: args.orgId, barcode: { in: barcodes } },
          select: {
            id: true,
            barcode: true,
            stockCode: true,
            dimensionalWeightOverride: true,
            syncedDimensionalWeight: true,
            isDigital: true,
            product: {
              select: {
                title: true,
                imageUrls: true,
              },
            },
          },
        })
      : [];
  const variantById = new Map(variants.map((v) => [v.id, v]));

  // The calculability gate's own lines for this order, scoped by organizationId +
  // storeId and judged at the order's cost decision time (its business-day end), as
  // the gate that holds the order judges them. The decision time comes from the
  // row's order_date column, as in the promote and flush workers, never from the
  // JSONB. buildCalcCheckLines returns one line per input line in input order, so
  // index i is mapped.lines[i].
  const calcLines = await buildCalcCheckLines(prisma, {
    organizationId: args.orgId,
    storeId: args.storeId,
    lines: mapped.lines.map((l) => ({ barcode: l.barcode })),
    at: costDecisionTime(entry.orderDate),
  });

  const lines: BufferDetailLine[] = mapped.lines.map((line, index) => {
    const calcLine = calcLines[index];
    // The variant the gate resolved for this line, so the name, the desi and the cost
    // flag describe one variant even when two variants of the store share a barcode.
    const gateVariantId = calcLine?.variantId ?? null;
    const variant = gateVariantId === null ? undefined : variantById.get(gateVariantId);
    return {
      barcode: line.barcode,
      productName: variant?.product.title ?? line.barcode,
      thumbUrl: variant?.product.imageUrls[0] ?? null,
      variantId: variant?.id ?? null,
      stockCode: variant?.stockCode ?? null,
      quantity: line.quantity,
      lineSaleGross: new Decimal(line.lineSaleGross).toFixed(2),
      // Fail closed: a line the gate did not return counts as cost-missing.
      isCostMissing: calcLine === undefined || calcLine.unitCostSnapshotNet === null,
      ...(variant === undefined ? UNRESOLVED_DESI_FIELDS : toVariantDesiFields(variant)),
    };
  });

  return {
    platformOrderNumber: entry.platformOrderNumber,
    orderDate: orderDate.toISOString(),
    status: mapped.status,
    saleGross: new Decimal(mapped.saleGross).toFixed(2),
    lines,
  };
}

/** A buffer row's JSONB order date as a Date; null when it is missing or not a valid date string. */
function parseMappedOrderDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The notification's served profit for an orders-source summary (decision 10): the
 * order's stored ESTIMATE statement net when it is ESTIMATED, else null. When no
 * estimate statement is stored yet, the engine computes it read-only in the request
 * (computeParcelProfitForRead) and the same ESTIMATED gate applies; an unsupported
 * platform or a failed computation yields null. Every amount is toFixed(2).
 */
async function notificationProfit(
  orgId: string,
  orderId: string,
  statements: readonly EstimateStatementRow[],
): Promise<string | null> {
  const stored = statements[0];
  if (stored !== undefined) {
    return stored.status === ProfitStatus.ESTIMATED && stored.netProfit !== null
      ? new Decimal(stored.netProfit.toString()).toFixed(2)
      : null;
  }
  const computed = await computeParcelProfitForRead({
    organizationId: orgId,
    orderId,
    surface: 'order-notification',
  });
  const estimate = computed?.estimate ?? null;
  return estimate !== null &&
    estimate.status === ProfitStatus.ESTIMATED &&
    estimate.netProfit !== null
    ? estimate.netProfit.toFixed(2)
    : null;
}

/**
 * Canonical revenue/profit summary for a realtime new-order toast. Looks the
 * row up by id (org + store scoped) so a cross-tenant id returns NotFoundError.
 * Profit reads the order's ESTIMATE statement (or an in-request computation when none
 * is stored); `isToday` lets the client drop backfills / historical inserts.
 */
export async function getNewOrderNotificationSummary(args: {
  orgId: string;
  storeId: string;
  source: 'orders' | 'buffer';
  id: string;
}): Promise<NewOrderNotificationSummary> {
  if (args.source === 'orders') {
    const order = await prisma.order.findFirst({
      where: { id: args.id, organizationId: args.orgId, storeId: args.storeId },
      select: {
        id: true,
        platformOrderNumber: true,
        saleGross: true,
        orderDate: true,
        status: true,
        // The order's ESTIMATE statement (decision 10) -- the profit source when stored.
        profitStatements: {
          where: estimateStatementWhere(args.orgId, args.storeId),
          select: ESTIMATE_STATEMENT_SELECT,
        },
        // Buffer-graduation marker: non-null when the order came from the
        // live-performance buffer (the seller already saw it). Drives isPromotion
        // so the client can drop a duplicate toast for an already-shown order.
        promotedFromBufferAt: true,
      },
    });
    if (order === null) {
      throw new NotFoundError('Order', args.id);
    }
    const { start, end } = getBusinessDayRange();
    const profit = await notificationProfit(args.orgId, order.id, order.profitStatements);
    return {
      source: 'orders',
      orderId: order.id,
      bufferId: null,
      platformOrderNumber: order.platformOrderNumber,
      revenue: new Decimal(order.saleGross ?? 0).toFixed(2),
      profit,
      costStatus: profit !== null ? 'costed' : 'pending',
      isToday: order.orderDate >= start && order.orderDate < end,
      status: order.status,
      isPromotion: order.promotedFromBufferAt !== null,
    };
  }

  const entry = await prisma.livePerformanceBuffer.findFirst({
    where: { id: args.id, organizationId: args.orgId, storeId: args.storeId },
    select: { id: true, platformOrderNumber: true, mappedOrder: true, orderDate: true },
  });
  if (entry === null) {
    throw new NotFoundError('BufferEntry', args.id);
  }
  const mapped = entry.mappedOrder as unknown as MappedOrder;
  return {
    source: 'buffer',
    orderId: null,
    bufferId: entry.id,
    platformOrderNumber: entry.platformOrderNumber,
    revenue: new Decimal(mapped.saleGross).toFixed(2),
    profit: null,
    costStatus: 'pending',
    isToday: entry.orderDate.getTime() === getBusinessDateAnchor().getTime(),
    // A buffer entry is not yet an order: it has no lifecycle status and cannot be
    // cancelled, and it is never itself a promotion (promotion is the graduation
    // INTO orders). Both stay null/false so the client's status/isPromotion gates
    // are no-ops for buffer sources.
    status: null,
    isPromotion: false,
  };
}
