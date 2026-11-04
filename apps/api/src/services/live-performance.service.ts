import type { Prisma } from '@pazarsync/db';
import { prisma } from '@pazarsync/db';
import { ProfitStatementView, ProfitStatus, type OrderStatus } from '@pazarsync/db/enums';
import type { MappedOrder } from '@pazarsync/marketplace';
import {
  itemProfitValues,
  loadOrderProfitLines,
  parseStoredIssues,
  selectLines,
} from '@pazarsync/profit';
import { getBusinessDateAnchor, getBusinessDayRange, getBusinessHour } from '@pazarsync/utils';
import Decimal from 'decimal.js';

import { resolveVendorMissingBarcodes } from '../lib/catalog-barcode-miss-lookup';
import { NotFoundError } from '../lib/errors';
import { toPromotionDisplays, type PromotionDisplayWire } from '../lib/promotion-displays';
import {
  computeParcelProfitForRead,
  logProfitReadFailure,
} from './profit-compute-fallback.service';

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
function aggregateRatio(profit: Decimal, denominator: Decimal): string {
  if (denominator.isZero()) return '0.00';
  return profit.div(denominator).mul(100).toFixed(2);
}

// The ESTIMATE statement columns live performance reads: the status gates the costed
// subset (decision 10), net profit drives the KPI/chart/feed profit, cost_gross is the
// Kar/Maliyet ratio denominator (replacing the always-null item cost snapshots), and
// sale_margin_pct is the per-order margin the feed surfaces.
const ESTIMATE_STATEMENT_SELECT = {
  status: true,
  netProfit: true,
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
 * The order's ESTIMATE statement when it is costed -- stored and ESTIMATED, so its net
 * profit is non-null (decision 10). Returns null for a missing statement or one that
 * never reached ESTIMATED (NOT_COMPUTABLE / EXCLUDED / cancelled). Callers still guard
 * net profit before using it, so the type stays honest about the nullable column.
 */
function costedEstimate(statements: readonly EstimateStatementRow[]): EstimateStatementRow | null {
  const estimate = statements[0];
  if (estimate === undefined) return null;
  if (estimate.status !== ProfitStatus.ESTIMATED) return null;
  return estimate;
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
  netProfitYesterday: string;
  marginToday: string;
  marginYesterday: string;
  profitCostRatioToday: string;
  profitCostRatioYesterday: string;
  pendingRevenueToday: string;
  pendingOrderCountToday: number;
}

interface OrdersAggregate {
  revenue: Decimal; // universe (all orders in range)
  orderCount: number; // universe
  unitsSold: number; // universe
  netProfit: Decimal; // costed subset
  costedRevenue: Decimal; // costed subset (margin denominator)
  costedCost: Decimal; // costed subset (Kâr/Maliyet denominator)
  costedCount: number; // costed subset
}

interface BufferAggregate {
  revenue: Decimal;
  orderCount: number;
  unitsSold: number;
}

/**
 * Aggregate the `orders` rows for a day. Volume (revenue / count / units) is over
 * EVERY non-cancelled order; profit / costed-revenue / costed-cost / costed-count are
 * over the costed subset only -- orders whose ESTIMATE statement is ESTIMATED
 * (decision 10). The costed net and cost_gross come from that statement; the costed
 * revenue is the order's own sale_gross. Today's cost-missing orders sit in the buffer
 * (not here); yesterday's profit-excluded orders carry an EXCLUDED estimate and so land
 * in volume but never in the costed aggregates.
 */
async function aggregateOrders(
  orgId: string,
  storeId: string,
  range: DayRange,
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
    select: {
      saleGross: true,
      items: { select: { quantity: true } },
      profitStatements: {
        where: estimateStatementWhere(orgId, storeId),
        select: ESTIMATE_STATEMENT_SELECT,
      },
    },
  });

  let revenue = new Decimal(0);
  let unitsSold = 0;
  let netProfit = new Decimal(0);
  let costedRevenue = new Decimal(0);
  let costedCost = new Decimal(0);
  let costedCount = 0;

  for (const order of orders) {
    if (order.saleGross !== null) revenue = revenue.add(order.saleGross.toString());
    for (const item of order.items) unitsSold += item.quantity;

    const estimate = costedEstimate(order.profitStatements);
    if (estimate === null || estimate.netProfit === null) continue;
    netProfit = netProfit.add(estimate.netProfit.toString());
    costedCount += 1;
    if (order.saleGross !== null) costedRevenue = costedRevenue.add(order.saleGross.toString());
    costedCost = costedCost.add(estimate.costGross.toString());
  }

  return {
    revenue,
    orderCount: orders.length,
    unitsSold,
    netProfit,
    costedRevenue,
    costedCost,
    costedCount,
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
  // `orders` as PROFIT-EXCLUDED at midnight, so `orders` is already complete.
  const [todayOrders, todayBuffer, yesterdayOrders] = await Promise.all([
    aggregateOrders(args.orgId, args.storeId, today),
    aggregateBuffer(args.orgId, args.storeId, todayAnchor),
    aggregateOrders(args.orgId, args.storeId, yesterday),
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
    netProfitYesterday: yesterdayOrders.netProfit.toFixed(2),
    marginToday: aggregateRatio(todayOrders.netProfit, todayOrders.costedRevenue),
    marginYesterday: aggregateRatio(yesterdayOrders.netProfit, yesterdayOrders.costedRevenue),
    profitCostRatioToday: aggregateRatio(todayOrders.netProfit, todayOrders.costedCost),
    profitCostRatioYesterday: aggregateRatio(yesterdayOrders.netProfit, yesterdayOrders.costedCost),
    pendingRevenueToday: todayRevenue.sub(todayOrders.costedRevenue).toFixed(2),
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
 * subset -- the costed ESTIMATE statement's net, by order hour (decision 10). The
 * two running totals drive the front-end's ciro<->kar toggle without a second request.
 */
async function hourlyCumulative(
  orgId: string,
  storeId: string,
  range: DayRange,
  bufferAnchor: Date | null,
): Promise<ChartPoint[]> {
  const orders = await prisma.order.findMany({
    where: {
      organizationId: orgId,
      storeId,
      orderDate: { gte: range.start, lt: range.end },
      // Mirrors aggregateOrders — cancelled orders carry no payout.
      status: { not: 'CANCELLED' },
    },
    select: {
      orderDate: true,
      saleGross: true,
      profitStatements: {
        where: estimateStatementWhere(orgId, storeId),
        select: ESTIMATE_STATEMENT_SELECT,
      },
    },
  });

  const revenueBuckets = Array.from({ length: HOURS_IN_DAY }, () => new Decimal(0));
  const profitBuckets = Array.from({ length: HOURS_IN_DAY }, () => new Decimal(0));

  for (const order of orders) {
    const hour = getBusinessHour(order.orderDate);
    if (order.saleGross !== null)
      revenueBuckets[hour] = (revenueBuckets[hour] ?? new Decimal(0)).add(
        order.saleGross.toString(),
      );
    const estimate = costedEstimate(order.profitStatements);
    if (estimate !== null && estimate.netProfit !== null)
      profitBuckets[hour] = (profitBuckets[hour] ?? new Decimal(0)).add(
        estimate.netProfit.toString(),
      );
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

  const [todayPoints, yesterdayPoints] = await Promise.all([
    hourlyCumulative(args.orgId, args.storeId, today, todayAnchor),
    hourlyCumulative(args.orgId, args.storeId, yesterday, null),
  ]);

  return { today: todayPoints, yesterday: yesterdayPoints };
}

// ─── Today's Products (orders ∪ today buffer, per barcode) ──────────────────────

export interface TodayProductRow {
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
 * for deterministic output; the frontend owns the live re-sort.
 */
export async function getTodayProducts(args: {
  orgId: string;
  storeId: string;
}): Promise<TodayProductRow[]> {
  const { start, end } = getBusinessDayRange();
  const todayAnchor = getBusinessDateAnchor();

  const [orderItems, bufferRows] = await Promise.all([
    prisma.orderItem.findMany({
      where: {
        productVariantId: { not: null },
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
        productVariant: {
          select: {
            id: true,
            barcode: true,
            stockCode: true,
            product: {
              select: {
                title: true,
                imageUrls: true,
              },
            },
          },
        },
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
    };
    byVariant.set(identity.id, created);
    return created;
  };

  // Orders: identity comes straight from the joined variant.
  for (const item of orderItems) {
    const variant = item.productVariant;
    if (variant === null) continue; // defensive — already filtered in the query
    const acc = ensure({
      id: variant.id,
      variantId: variant.id,
      barcode: variant.barcode,
      stockCode: variant.stockCode,
      productName: variant.product.title,
      thumbUrl: variant.product.imageUrls[0] ?? null,
      unresolved: false,
    });
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
  }

  // Buffer: aggregate lines by barcode first (the entry carries no variant id),
  // then resolve identity for barcodes not already seen in orders.
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

  const bufferBarcodes = [...bufferByBarcode.keys()];
  const bufferVariants =
    bufferBarcodes.length > 0
      ? await prisma.productVariant.findMany({
          where: {
            storeId: args.storeId,
            organizationId: args.orgId,
            barcode: { in: bufferBarcodes },
          },
          select: {
            id: true,
            barcode: true,
            stockCode: true,
            product: {
              select: {
                title: true,
                imageUrls: true,
              },
            },
          },
        })
      : [];
  const variantByBarcode = new Map(bufferVariants.map((variant) => [variant.barcode, variant]));

  for (const [barcode, agg] of bufferByBarcode) {
    const variant = variantByBarcode.get(barcode);
    // Çözülemeyen barkod DÜŞÜRÜLMEZ (görünürlük sözleşmesi, spec 2026-06-12
    // §7): satıcı "1 sipariş var ama ürün listesi boş" tutarsızlığını asla
    // görmez. Eager onarım (PR-2) sayesinde bu satır nadir istisnadır.
    const acc = ensure(
      variant !== undefined
        ? {
            id: variant.id,
            variantId: variant.id,
            barcode: variant.barcode,
            stockCode: variant.stockCode,
            productName: variant.product.title,
            thumbUrl: variant.product.imageUrls[0] ?? null,
            unresolved: false,
          }
        : {
            id: `barcode:${barcode}`,
            variantId: null,
            barcode,
            stockCode: null,
            productName: null,
            thumbUrl: null,
            unresolved: true,
          },
    );
    acc.bufferEntryCount += agg.entryIds.size;
    acc.unitsSold += agg.units;
    acc.revenue = acc.revenue.add(agg.revenue);
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
      orderBy: { orderDate: 'desc' },
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

  const calculatedRows: LiveOrderRow[] = ordersToday.map((order) => {
    const revenue =
      order.saleGross !== null ? new Decimal(order.saleGross.toString()) : new Decimal(0);
    // Profit + margin read the ESTIMATE statement, only when it is ESTIMATED
    // (decision 10) -- render-time recompute YOK.
    const estimate = costedEstimate(order.profitStatements);
    const profit =
      estimate !== null && estimate.netProfit !== null
        ? new Decimal(estimate.netProfit.toString())
        : null;
    const margin =
      estimate !== null && estimate.saleMarginPct !== null
        ? new Decimal(estimate.saleMarginPct.toString()).toFixed(2)
        : null;
    return {
      source: 'orders',
      platformOrderId: order.platformOrderId,
      platformOrderNumber: order.platformOrderNumber,
      orderId: order.id,
      bufferId: null,
      orderDate: order.orderDate.toISOString(),
      status: order.status,
      revenue: revenue.toFixed(2),
      profit: profit !== null ? profit.toFixed(2) : null,
      margin,
      // Promosyon adları liste detayıyla aynı runtime-doğrulamalı dönüşümden geçer.
      promotionDisplays: toPromotionDisplays(order.promotionDisplays),
    };
  });

  const pendingRows: LiveOrderRow[] = bufferRows.map((entry) => {
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

  const dataByFilter: Record<typeof filter, LiveOrderRow[]> = {
    all: [...calculatedRows, ...pendingRows].sort((a, b) => b.orderDate.localeCompare(a.orderDate)),
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

export interface BufferDetailLine {
  barcode: string;
  productName: string;
  thumbUrl: string | null;
  variantId: string | null;
  stockCode: string | null;
  quantity: number;
  // GROSS konvansiyon (2026-06-16): lineSaleGross satır toplamı (KDV-dahil, × quantity).
  lineSaleGross: string;
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
      mappedOrder: true,
    },
  });
  if (entry === null) {
    throw new NotFoundError('BufferEntry', args.bufferId);
  }

  const mapped = entry.mappedOrder as unknown as MappedOrder;

  const barcodes = [...new Set(mapped.lines.map((l) => l.barcode))];
  const variants =
    barcodes.length > 0
      ? await prisma.productVariant.findMany({
          where: { storeId: args.storeId, organizationId: args.orgId, barcode: { in: barcodes } },
          select: {
            id: true,
            barcode: true,
            stockCode: true,
            product: {
              select: {
                title: true,
                imageUrls: true,
              },
            },
          },
        })
      : [];
  const byBarcode = new Map(variants.map((v) => [v.barcode, v]));

  const lines: BufferDetailLine[] = mapped.lines.map((line) => {
    const variant = byBarcode.get(line.barcode);
    return {
      barcode: line.barcode,
      productName: variant?.product.title ?? line.barcode,
      thumbUrl: variant?.product.imageUrls[0] ?? null,
      variantId: variant?.id ?? null,
      stockCode: variant?.stockCode ?? null,
      quantity: line.quantity,
      lineSaleGross: new Decimal(line.lineSaleGross).toFixed(2),
    };
  });

  return {
    platformOrderNumber: entry.platformOrderNumber,
    orderDate: new Date(mapped.orderDate).toISOString(),
    status: mapped.status,
    saleGross: new Decimal(mapped.saleGross).toFixed(2),
    lines,
  };
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
