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

// ─── Missing-Cost ─────────────────────────────────────────────────────────────

export interface MissingCostRow {
  variantId: string;
  barcode: string;
  stockCode: string;
  productName: string;
  thumbUrl: string | null;
  orderCount: number;
  revenueImpact: string;
}

export async function getMissingCost(args: {
  orgId: string;
  storeId: string;
}): Promise<MissingCostRow[]> {
  const todayAnchor = getBusinessDateAnchor();

  // Group today's PENDING buffer entries by the barcode of each mapped line.
  // revenueImpact = the order subtotal blocked by the missing cost (whole order
  // can't be computed until every line is costed).
  const rows = await prisma.$queryRaw<
    Array<{ barcode: string; orderCount: bigint; revenueImpact: string }>
  >`
    SELECT
      line ->> 'barcode' AS barcode,
      COUNT(*) AS "orderCount",
      COALESCE(SUM((mapped_order ->> 'saleSubtotalNet')::numeric), 0)::text AS "revenueImpact"
    FROM live_performance_buffer
    CROSS JOIN LATERAL jsonb_array_elements(mapped_order -> 'lines') AS line
    WHERE store_id = ${args.storeId}::uuid
      AND organization_id = ${args.orgId}::uuid
      AND status = 'PENDING'::buffer_entry_status
      AND order_date = ${todayAnchor}::date
    GROUP BY line ->> 'barcode'
    ORDER BY "orderCount" DESC
  `;

  if (rows.length === 0) return [];

  const barcodes = rows.map((row) => row.barcode);
  const variants = await prisma.productVariant.findMany({
    where: { storeId: args.storeId, organizationId: args.orgId, barcode: { in: barcodes } },
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
  });

  // A multi-line PENDING order can contain lines that DO have a cost (siblings of
  // a still-missing one). Surface only the genuinely cost-missing variants — the
  // actionable ones — so the seller's "add cost" list isn't polluted.
  const costedVariantIds = new Set(
    (
      await prisma.productVariantCostProfile.findMany({
        where: {
          productVariantId: { in: variants.map((v) => v.id) },
          organizationId: args.orgId,
          profile: { archivedAt: null },
        },
        select: { productVariantId: true },
      })
    ).map((link) => link.productVariantId),
  );

  const byBarcode = new Map(variants.map((variant) => [variant.barcode, variant]));

  return rows.flatMap((row) => {
    const variant = byBarcode.get(row.barcode);
    if (variant === undefined || costedVariantIds.has(variant.id)) return [];
    return [
      {
        variantId: variant.id,
        barcode: row.barcode,
        stockCode: variant.stockCode,
        productName: variant.product.title,
        thumbUrl: variant.product.images[0]?.url ?? null,
        orderCount: Number(row.orderCount),
        revenueImpact: new Decimal(row.revenueImpact).toFixed(2),
      },
    ];
  });
}

// ─── Top-Products ─────────────────────────────────────────────────────────────

export interface TopProductRow {
  rank: number;
  variantId: string;
  productName: string;
  thumbUrl: string | null;
  orderCount: number;
  revenue: string;
  profit: string | null;
}

interface VariantAggregate {
  variantId: string;
  productName: string;
  thumbUrl: string | null;
  orderCount: number;
  revenue: Decimal;
  profit: Decimal | null;
}

const TOP_PRODUCTS_LIMIT = 3;

export async function getTopProducts(args: {
  orgId: string;
  storeId: string;
}): Promise<TopProductRow[]> {
  const { start, end } = getBusinessDayRange();

  const items = await prisma.orderItem.findMany({
    where: {
      order: {
        organizationId: args.orgId,
        storeId: args.storeId,
        orderDate: { gte: start, lt: end },
      },
    },
    select: {
      quantity: true,
      unitPriceNet: true,
      productVariant: {
        select: {
          id: true,
          product: {
            select: {
              title: true,
              images: { orderBy: { position: 'asc' }, take: 1, select: { url: true } },
            },
          },
        },
      },
      order: { select: { estimatedNetProfit: true } },
    },
  });

  const byVariant = new Map<string, VariantAggregate>();
  for (const item of items) {
    const variant = item.productVariant;
    if (variant === null) continue;

    const existing = byVariant.get(variant.id) ?? {
      variantId: variant.id,
      productName: variant.product.title,
      thumbUrl: variant.product.images[0]?.url ?? null,
      orderCount: 0,
      revenue: new Decimal(0),
      profit: new Decimal(0) as Decimal | null,
    };

    const unitPriceNet =
      item.unitPriceNet !== null ? new Decimal(item.unitPriceNet.toString()) : new Decimal(0);
    existing.revenue = existing.revenue.add(unitPriceNet.mul(item.quantity));
    existing.orderCount += 1;
    // profit is informational and best-effort: an order's whole estimated profit
    // is attributed to each of its variants. null if any contributing order has
    // no estimate yet (settlement not reconciled / cost incomplete).
    if (existing.profit !== null && item.order.estimatedNetProfit !== null) {
      existing.profit = existing.profit.add(item.order.estimatedNetProfit.toString());
    } else {
      existing.profit = null;
    }
    byVariant.set(variant.id, existing);
  }

  return Array.from(byVariant.values())
    .sort((a, b) => b.orderCount - a.orderCount)
    .slice(0, TOP_PRODUCTS_LIMIT)
    .map((aggregate, index) => ({
      rank: index + 1,
      variantId: aggregate.variantId,
      productName: aggregate.productName,
      thumbUrl: aggregate.thumbUrl,
      orderCount: aggregate.orderCount,
      revenue: aggregate.revenue.toFixed(2),
      profit: aggregate.profit !== null ? aggregate.profit.toFixed(2) : null,
    }));
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
      orderDate: entry.orderDate.toISOString(),
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
