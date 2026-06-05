import { prisma } from '@pazarsync/db';
import type { MappedOrder } from '@pazarsync/marketplace';
import { getBusinessDateAnchor, getBusinessDayRange, getBusinessHour } from '@pazarsync/utils';
import Decimal from 'decimal.js';

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

function computeMargin(profit: Decimal, revenue: Decimal): string {
  if (revenue.isZero()) return '0.00';
  return profit.div(revenue).mul(100).toFixed(2);
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
 * EVERY order; profit / costed-revenue / costed-cost / costed-count are over the
 * costed subset only (orders with a non-null estimatedNetProfit). Today's
 * cost-missing orders sit in the buffer (not here); yesterday's persisted
 * null-profit orders are here but excluded from the costed aggregates.
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
    },
    select: {
      saleSubtotalNet: true,
      estimatedNetProfit: true,
      items: { select: { quantity: true, unitCostSnapshotNet: true } },
    },
  });

  let revenue = new Decimal(0);
  let unitsSold = 0;
  let netProfit = new Decimal(0);
  let costedRevenue = new Decimal(0);
  let costedCost = new Decimal(0);
  let costedCount = 0;

  for (const order of orders) {
    if (order.saleSubtotalNet !== null) revenue = revenue.add(order.saleSubtotalNet.toString());
    for (const item of order.items) unitsSold += item.quantity;

    if (order.estimatedNetProfit === null) continue;
    netProfit = netProfit.add(order.estimatedNetProfit.toString());
    costedCount += 1;
    if (order.saleSubtotalNet !== null)
      costedRevenue = costedRevenue.add(order.saleSubtotalNet.toString());
    for (const item of order.items) {
      if (item.unitCostSnapshotNet !== null)
        costedCost = costedCost.add(
          new Decimal(item.unitCostSnapshotNet.toString()).mul(item.quantity),
        );
    }
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
    revenue = revenue.add(mapped.saleSubtotalNet);
    for (const line of mapped.lines) unitsSold += line.quantity;
  }
  return { revenue, orderCount: rows.length, unitsSold };
}

export async function getKpis(args: { orgId: string; storeId: string }): Promise<KpisResult> {
  const today = getBusinessDayRange();
  const yesterday = getBusinessDayRange(new Date(Date.now() - ONE_DAY_MS));
  const todayAnchor = getBusinessDateAnchor();

  // Yesterday never unions the buffer — its uncosted orders were graduated into
  // `orders` (null profit) at midnight, so `orders` is already complete.
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
    marginToday: computeMargin(todayOrders.netProfit, todayOrders.costedRevenue),
    marginYesterday: computeMargin(yesterdayOrders.netProfit, yesterdayOrders.costedRevenue),
    profitCostRatioToday: computeMargin(todayOrders.netProfit, todayOrders.costedCost),
    profitCostRatioYesterday: computeMargin(yesterdayOrders.netProfit, yesterdayOrders.costedCost),
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
 * subset (non-null estimate). The two running totals drive the front-end's
 * ciro↔kâr toggle without a second request.
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
    },
    select: { orderDate: true, saleSubtotalNet: true, estimatedNetProfit: true },
  });

  const revenueBuckets = Array.from({ length: HOURS_IN_DAY }, () => new Decimal(0));
  const profitBuckets = Array.from({ length: HOURS_IN_DAY }, () => new Decimal(0));

  for (const order of orders) {
    const hour = getBusinessHour(order.orderDate);
    if (order.saleSubtotalNet !== null)
      revenueBuckets[hour] = (revenueBuckets[hour] ?? new Decimal(0)).add(
        order.saleSubtotalNet.toString(),
      );
    if (order.estimatedNetProfit !== null)
      profitBuckets[hour] = (profitBuckets[hour] ?? new Decimal(0)).add(
        order.estimatedNetProfit.toString(),
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
      revenueBuckets[hour] = (revenueBuckets[hour] ?? new Decimal(0)).add(mapped.saleSubtotalNet);
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
  variantId: string;
  barcode: string;
  stockCode: string;
  productName: string;
  thumbUrl: string | null;
  orderCount: number;
  unitsSold: number;
  revenue: string;
  costStatus: 'costed' | 'missing';
  unitCost: string | null;
}

interface ProductAccumulator {
  variantId: string;
  barcode: string;
  stockCode: string;
  productName: string;
  thumbUrl: string | null;
  orderIds: Set<string>; // distinct orders (orders table) containing this variant
  bufferEntryCount: number; // distinct buffer entries containing this barcode
  unitsSold: number;
  revenue: Decimal;
  snapshotUnitCost: Decimal | null; // net unit cost actually applied (costed rows)
}

interface VariantIdentity {
  id: string;
  barcode: string;
  stockCode: string;
  productName: string;
  thumbUrl: string | null;
}

/**
 * One row per product variant that sold today, merged over the universe:
 * `orders`(today) ∪ `buffer`(today). Volume (orderCount / unitsSold / revenue) is
 * known the moment the order arrives — no cost required. costStatus is resolved
 * from the active ProductVariantCostProfile (authoritative; matches the retired
 * getMissingCost), and the displayed unitCost is the net snapshot the profit
 * engine actually applied to today's costed orders. There is NO per-product
 * profit (an order's net profit can't be cleanly attributed to one line). Rows
 * are returned sorted by unitsSold desc for deterministic output; the frontend
 * owns the live re-sort.
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
        },
      },
      select: {
        orderId: true,
        quantity: true,
        unitPriceNet: true,
        unitCostSnapshotNet: true,
        productVariant: {
          select: {
            id: true,
            barcode: true,
            stockCode: true,
            product: {
              select: {
                title: true,
                images: { orderBy: { position: 'asc' }, take: 1, select: { url: true } },
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
      variantId: identity.id,
      barcode: identity.barcode,
      stockCode: identity.stockCode,
      productName: identity.productName,
      thumbUrl: identity.thumbUrl,
      orderIds: new Set<string>(),
      bufferEntryCount: 0,
      unitsSold: 0,
      revenue: new Decimal(0),
      snapshotUnitCost: null,
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
      barcode: variant.barcode,
      stockCode: variant.stockCode,
      productName: variant.product.title,
      thumbUrl: variant.product.images[0]?.url ?? null,
    });
    acc.orderIds.add(item.orderId);
    acc.unitsSold += item.quantity;
    if (item.unitPriceNet !== null) {
      acc.revenue = acc.revenue.add(new Decimal(item.unitPriceNet.toString()).mul(item.quantity));
    }
    // First non-null snapshot wins. If the variant was costed at differing
    // snapshots intraday, this shows a representative applied cost (the cell is
    // a quiet reference, not a reconciled figure).
    if (acc.snapshotUnitCost === null && item.unitCostSnapshotNet !== null) {
      acc.snapshotUnitCost = new Decimal(item.unitCostSnapshotNet.toString());
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
      agg.revenue = agg.revenue.add(new Decimal(line.unitPriceNet).mul(line.quantity));
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
                images: { orderBy: { position: 'asc' }, take: 1, select: { url: true } },
              },
            },
          },
        })
      : [];
  const variantByBarcode = new Map(bufferVariants.map((variant) => [variant.barcode, variant]));

  for (const [barcode, agg] of bufferByBarcode) {
    const variant = variantByBarcode.get(barcode);
    if (variant === undefined) continue; // unresolved barcode — no identity, skip
    const acc = ensure({
      id: variant.id,
      barcode: variant.barcode,
      stockCode: variant.stockCode,
      productName: variant.product.title,
      thumbUrl: variant.product.images[0]?.url ?? null,
    });
    acc.bufferEntryCount += agg.entryIds.size;
    acc.unitsSold += agg.units;
    acc.revenue = acc.revenue.add(agg.revenue);
  }

  // Cost status: a variant is costed iff it has an active (non-archived) cost
  // profile — authoritative, independent of buffer/orders presence.
  const variantIds = [...byVariant.keys()];
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

  return [...byVariant.values()]
    .map((acc) => {
      const costed = costedVariantIds.has(acc.variantId);
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
        unitCost: costed && acc.snapshotUnitCost !== null ? acc.snapshotUnitCost.toFixed(2) : null,
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
  orderDate: string;
  status: string;
  revenue: string;
  profit: string | null;
  margin: string | null;
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
      },
      orderBy: { orderDate: 'desc' },
      select: {
        platformOrderId: true,
        platformOrderNumber: true,
        orderDate: true,
        status: true,
        saleSubtotalNet: true,
        estimatedNetProfit: true,
      },
    }),
    prisma.livePerformanceBuffer.findMany({
      where: { organizationId: args.orgId, storeId: args.storeId, orderDate: todayAnchor },
      orderBy: { createdAt: 'desc' },
      select: {
        platformOrderId: true,
        platformOrderNumber: true,
        orderDate: true,
        mappedOrder: true,
      },
    }),
  ]);

  const calculatedRows: LiveOrderRow[] = ordersToday.map((order) => {
    const revenue =
      order.saleSubtotalNet !== null
        ? new Decimal(order.saleSubtotalNet.toString())
        : new Decimal(0);
    const profit =
      order.estimatedNetProfit !== null ? new Decimal(order.estimatedNetProfit.toString()) : null;
    const margin = profit !== null ? computeMargin(profit, revenue) : null;
    return {
      source: 'orders',
      platformOrderId: order.platformOrderId,
      platformOrderNumber: order.platformOrderNumber,
      orderDate: order.orderDate.toISOString(),
      status: order.status,
      revenue: revenue.toFixed(2),
      profit: profit !== null ? profit.toFixed(2) : null,
      margin,
    };
  });

  const pendingRows: LiveOrderRow[] = bufferRows.map((entry) => {
    const mapped = entry.mappedOrder as unknown as MappedOrder;
    return {
      source: 'buffer',
      platformOrderId: entry.platformOrderId,
      platformOrderNumber: entry.platformOrderNumber,
      // The real order timestamp (hour-level) lives in the mapped payload; the
      // buffer's own `orderDate` column is date-only (midnight), which would
      // render every pending row at the same wrong "03:00".
      orderDate: new Date(mapped.orderDate).toISOString(),
      status: mapped.status,
      revenue: new Decimal(mapped.saleSubtotalNet).toFixed(2),
      profit: null,
      margin: null,
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
