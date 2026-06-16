import { prisma } from '@pazarsync/db';
import type { MappedOrder } from '@pazarsync/marketplace';
import { getBusinessDateAnchor, getBusinessDayRange, getBusinessHour } from '@pazarsync/utils';
import Decimal from 'decimal.js';

import { NotFoundError } from '../lib/errors';

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

// Aggregate KPI ratio (net profit ÷ denominator × 100), computed and SERVED by
// the backend over the costed subset. This is NOT a render-time per-order margin
// derivation (the rule-violation target removed in Bölüm H is the frontend
// computeMargin in order-kpi-grid); the per-order margin in getLiveOrders is read
// straight from the persisted estimatedSaleMarginPct column, never recomputed.
function aggregateRatio(profit: Decimal, denominator: Decimal): string {
  if (denominator.isZero()) return '0.00';
  return profit.div(denominator).mul(100).toFixed(2);
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
 * profit-excluded orders (estimate null) are here but excluded from the costed
 * aggregates.
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
      estimatedNetProfit: true,
      items: { select: { quantity: true, unitCostSnapshotGross: true } },
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

    if (order.estimatedNetProfit === null) continue;
    netProfit = netProfit.add(order.estimatedNetProfit.toString());
    costedCount += 1;
    if (order.saleGross !== null) costedRevenue = costedRevenue.add(order.saleGross.toString());
    for (const item of order.items) {
      if (item.unitCostSnapshotGross !== null)
        costedCost = costedCost.add(
          new Decimal(item.unitCostSnapshotGross.toString()).mul(item.quantity),
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
      // Mirrors aggregateOrders — cancelled orders carry no payout.
      status: { not: 'CANCELLED' },
    },
    select: { orderDate: true, saleGross: true, estimatedNetProfit: true },
  });

  const revenueBuckets = Array.from({ length: HOURS_IN_DAY }, () => new Decimal(0));
  const profitBuckets = Array.from({ length: HOURS_IN_DAY }, () => new Decimal(0));

  for (const order of orders) {
    const hour = getBusinessHour(order.orderDate);
    if (order.saleGross !== null)
      revenueBuckets[hour] = (revenueBuckets[hour] ?? new Decimal(0)).add(
        order.saleGross.toString(),
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
  snapshotUnitCost: Decimal | null; // gross unit cost actually applied (costed rows)
  unresolved: boolean;
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
          // Mirrors aggregateOrders — cancelled orders carry no payout.
          status: { not: 'CANCELLED' },
        },
      },
      select: {
        orderId: true,
        quantity: true,
        lineSaleGross: true,
        unitCostSnapshotGross: true,
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
      variantId: identity.variantId,
      barcode: identity.barcode,
      stockCode: identity.stockCode,
      productName: identity.productName,
      thumbUrl: identity.thumbUrl,
      orderIds: new Set<string>(),
      bufferEntryCount: 0,
      unitsSold: 0,
      revenue: new Decimal(0),
      snapshotUnitCost: null,
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
      thumbUrl: variant.product.images[0]?.url ?? null,
      unresolved: false,
    });
    acc.orderIds.add(item.orderId);
    acc.unitsSold += item.quantity;
    // lineSaleGross is the LINE total (KDV-dahil, already × quantity) — add directly.
    acc.revenue = acc.revenue.add(item.lineSaleGross.toString());
    // First non-null snapshot wins. If the variant was costed at differing
    // snapshots intraday, this shows a representative applied cost (the cell is
    // a quiet reference, not a reconciled figure). unitCostSnapshotGross is the
    // per-unit cost (KDV-dahil).
    if (acc.snapshotUnitCost === null && item.unitCostSnapshotGross !== null) {
      acc.snapshotUnitCost = new Decimal(item.unitCostSnapshotGross.toString());
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
                images: { orderBy: { position: 'asc' }, take: 1, select: { url: true } },
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
            thumbUrl: variant.product.images[0]?.url ?? null,
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

  return [...byVariant.values()]
    .map((acc) => {
      const costed = acc.variantId !== null && costedVariantIds.has(acc.variantId);
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
        unresolved: acc.unresolved,
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
        estimatedNetProfit: true,
        // Marj kalıcı kolondan okunur — render-time hesap yok (kural: backend servis eder).
        estimatedSaleMarginPct: true,
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
    const profit =
      order.estimatedNetProfit !== null ? new Decimal(order.estimatedNetProfit.toString()) : null;
    // Marj kalıcı estimatedSaleMarginPct kolonundan — render-time recompute YOK.
    const margin =
      order.estimatedSaleMarginPct !== null
        ? new Decimal(order.estimatedSaleMarginPct.toString()).toFixed(2)
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
                images: { orderBy: { position: 'asc' }, take: 1, select: { url: true } },
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
      thumbUrl: variant?.product.images[0]?.url ?? null,
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
 * Canonical revenue/profit summary for a realtime new-order toast. Looks the
 * row up by id (org + store scoped) so a cross-tenant id returns NotFoundError
 * and the post-event read sees the settled money columns. `isToday` lets the
 * client drop backfills / historical inserts.
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
        estimatedNetProfit: true,
        orderDate: true,
      },
    });
    if (order === null) {
      throw new NotFoundError('Order', args.id);
    }
    const { start, end } = getBusinessDayRange();
    const profit =
      order.estimatedNetProfit !== null ? new Decimal(order.estimatedNetProfit).toFixed(2) : null;
    return {
      source: 'orders',
      orderId: order.id,
      bufferId: null,
      platformOrderNumber: order.platformOrderNumber,
      revenue: new Decimal(order.saleGross ?? 0).toFixed(2),
      profit,
      costStatus: profit !== null ? 'costed' : 'pending',
      isToday: order.orderDate >= start && order.orderDate < end,
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
  };
}
