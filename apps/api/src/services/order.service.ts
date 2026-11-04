import type { Prisma } from '@pazarsync/db';
import { prisma } from '@pazarsync/db';
import { OrderStatus, ProfitStatementView, ReconciliationStatus } from '@pazarsync/db/enums';
import {
  STORED_STATEMENT_TOTALS_SELECT,
  buildStatementBreakdown,
  itemProfitValues,
  loadOrderProfitLines,
  parseStoredIssues,
  roundPercent,
  selectLines,
  statementTotalsFromRow,
  statementTotalsFromStatement,
  type ItemProfitValues,
  type ProfitIssue,
  type ProfitLine,
  type ProfitStatement,
  type StatementBreakdown,
} from '@pazarsync/profit';
import { Decimal } from 'decimal.js';

import { resolveVendorMissingBarcodes } from '../lib/catalog-barcode-miss-lookup';
import { NotFoundError } from '../lib/errors';
import {
  STATEMENT_LIST_SELECT,
  orderProfitFields,
  toStatementPair,
  type OrderProfitFields,
  type StatementListRow,
} from '../lib/order-profit-fields';
import { toPromotionDisplays } from '../lib/promotion-displays';
import type {
  ListOrdersQuery,
  OrderDetailResponse,
  OrderListItemResponse,
  OrderListSort,
  OrderSummaryQuery,
} from '../validators/order.validator';
import { computeParcelProfitForRead } from './profit-compute-fallback.service';

interface OrderListResult {
  data: OrderListItemResponse[];
  total: number;
  counts: { calculated: number; excluded: number };
}

interface OrderSummaryResult {
  totalRevenueGross: string;
  netProfitGross: string;
  avgMarginPct: string | null;
  lossOrderRate: { lossCount: number; totalCount: number; pct: string };
}

// buildOrderListWhere reads only the filter fields (not pagination/sort), so both
// the list query (ListOrdersQuery) and the summary query (which omits page/perPage/
// sort) structurally satisfy it.
type OrderListFilters = Pick<
  ListOrdersQuery,
  'status' | 'reconciliationStatus' | 'from' | 'to' | 'q' | 'costStatus' | 'lossOnly'
>;

/**
 * Verify the store belongs to the organization. Cross-tenant access from a
 * member of org A trying to read org B's storeId returns 404 (existence
 * non-disclosure) — never 403. The org-level membership check upstream has
 * already returned 403 if the user is not in the org at all.
 */
async function ensureStoreInOrg(orgId: string, storeId: string): Promise<void> {
  const store = await prisma.store.findFirst({
    where: { id: storeId, organizationId: orgId },
    select: { id: true },
  });
  if (store === null) {
    throw new NotFoundError('Store', storeId);
  }
}

/**
 * A reconciliationStatus filter reads the best-known statement (decision 2).
 * PARTIALLY/FULLY_SETTLED match orders whose best-known statement carries that
 * status; NOT_SETTLED matches the complement — orders with no settlement-started
 * best-known statement, including orders that have no statement at all. Every
 * relation filter carries organizationId for tenant isolation.
 */
function reconciliationStatusCondition(
  orgId: string,
  reconciliationStatus: ReconciliationStatus,
): Prisma.OrderWhereInput {
  switch (reconciliationStatus) {
    case ReconciliationStatus.NOT_SETTLED:
      // The complement: orders whose best-known statement has not started settling,
      // including orders with no best-known statement at all.
      return {
        NOT: {
          profitStatements: {
            some: {
              view: ProfitStatementView.BEST_KNOWN,
              organizationId: orgId,
              reconciliationStatus: {
                in: [ReconciliationStatus.PARTIALLY_SETTLED, ReconciliationStatus.FULLY_SETTLED],
              },
            },
          },
        },
      };
    case ReconciliationStatus.PARTIALLY_SETTLED:
    case ReconciliationStatus.FULLY_SETTLED:
      return {
        profitStatements: {
          some: {
            view: ProfitStatementView.BEST_KNOWN,
            organizationId: orgId,
            reconciliationStatus,
          },
        },
      };
    default: {
      const _exhaustive: never = reconciliationStatus;
      throw new Error(`Unhandled reconciliation status: ${_exhaustive}`);
    }
  }
}

function buildOrderListWhere(
  orgId: string,
  storeId: string,
  filters: OrderListFilters,
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {
    organizationId: orgId,
    storeId,
  };
  // The q filter uses where.OR, so the relation-backed filters compose via AND.
  const and: Prisma.OrderWhereInput[] = [];

  if (filters.status !== undefined) where.status = filters.status;

  if (filters.from !== undefined || filters.to !== undefined) {
    where.orderDate = {
      ...(filters.from !== undefined ? { gte: filters.from } : {}),
      ...(filters.to !== undefined ? { lte: filters.to } : {}),
    };
  }

  if (filters.q !== undefined) {
    where.OR = [
      { platformOrderNumber: { contains: filters.q, mode: 'insensitive' } },
      { platformOrderId: { contains: filters.q, mode: 'insensitive' } },
    ];
  }

  if (filters.reconciliationStatus !== undefined) {
    and.push(reconciliationStatusCondition(orgId, filters.reconciliationStatus));
  }

  // Calculated-or-excluded (decision 3): the segment key is the exclusion stamp,
  // not a statement — cancelled / not-computable / statement-less orders stay
  // "calculated" so long as they are not stamped out of the profit universe.
  if (filters.costStatus !== undefined) {
    switch (filters.costStatus) {
      case 'calculated':
        where.profitExcludedAt = null;
        break;
      case 'excluded':
        where.profitExcludedAt = { not: null };
        break;
      default: {
        const _exhaustive: never = filters.costStatus;
        throw new Error(`Unhandled cost status: ${_exhaustive}`);
      }
    }
  }

  // "Sadece zararlı": the best-known statement's net profit < 0 (decision 1).
  if (filters.lossOnly === true) {
    and.push({
      profitStatements: {
        some: {
          view: ProfitStatementView.BEST_KNOWN,
          organizationId: orgId,
          netProfit: { lt: 0 },
        },
      },
    });
  }

  if (and.length > 0) where.AND = and;

  return where;
}

/**
 * Include shape for an orders-list row: the item count and the org-scoped
 * profit statements (estimate + best-known) the list fields are derived from.
 * The profitStatements where carries organizationId so a statement filed under
 * another org for the same order id is never read (tenant isolation).
 */
function orderListInclude(orgId: string) {
  return {
    _count: { select: { items: true } },
    profitStatements: {
      where: { organizationId: orgId },
      select: STATEMENT_LIST_SELECT,
    },
  } satisfies Prisma.OrderInclude;
}

type OrderListRow = Prisma.OrderGetPayload<{
  include: {
    _count: { select: { items: true } };
    profitStatements: { select: typeof STATEMENT_LIST_SELECT };
  };
}>;

function toOrderListItem(row: OrderListRow): OrderListItemResponse {
  const fields = orderProfitFields({
    pair: toStatementPair(row.profitStatements),
    orderStatus: row.status,
    orderSaleGross: row.saleGross,
  });

  return {
    id: row.id,
    platformOrderId: row.platformOrderId,
    platformOrderNumber: row.platformOrderNumber,
    orderDate: row.orderDate.toISOString(),
    status: row.status,
    reconciliationStatus: fields.reconciliationStatus,
    saleGross: fields.saleGross,
    saleVat: row.saleVat?.toString() ?? null,
    listGross: row.listGross?.toString() ?? null,
    estimatedNetProfit: fields.estimatedNetProfit,
    settledNetProfit: fields.settledNetProfit,
    saleMarginPct: fields.saleMarginPct,
    costMarkupPct: fields.costMarkupPct,
    // Promosyon adları (spec ekleme #3): detaydakiyle aynı runtime-doğrulamalı
    // dönüşüm — liste satırı indirimin hangi promosyondan geldiğini gösterir.
    promotionDisplays: toPromotionDisplays(row.promotionDisplays),
    fastDelivery: row.fastDelivery,
    deliveredOnTime: row.deliveredOnTime,
    micro: row.micro,
    itemCount: row._count.items,
    // Kâr-dışı satırında sebep + tarih gösterimi için. Hesaplanan siparişlerde null.
    profitExcludedAt: row.profitExcludedAt?.toISOString() ?? null,
    profitExclusionReason: row.profitExclusionReason,
  };
}

/**
 * The page's ordered order ids for a margin sort, paged across two segments
 * (decision 5). Segment 1 is the orders that carry a best-known statement,
 * ordered by the statement's sale margin (nulls last, order id as the
 * tiebreaker). Segment 2 is the orders with no best-known statement, ordered by
 * order id descending. The two segments partition order.count(where), so paging
 * never repeats or skips a row at the boundary. Every relation filter carries
 * organizationId + storeId.
 */
async function listOrderIdsByMargin(
  orgId: string,
  storeId: string,
  where: Prisma.OrderWhereInput,
  sort: Prisma.SortOrder,
  skip: number,
  take: number,
): Promise<string[]> {
  const bestKnownStatementWhere: Prisma.OrderProfitStatementWhereInput = {
    view: ProfitStatementView.BEST_KNOWN,
    organizationId: orgId,
    storeId,
    order: { is: where },
  };

  const segment1Count = await prisma.orderProfitStatement.count({
    where: bestKnownStatementWhere,
  });

  const ids: string[] = [];

  if (skip < segment1Count) {
    const statements = await prisma.orderProfitStatement.findMany({
      where: bestKnownStatementWhere,
      orderBy: [{ saleMarginPct: { sort, nulls: 'last' } }, { orderId: 'desc' }],
      skip,
      take,
      select: { orderId: true },
    });
    for (const statement of statements) ids.push(statement.orderId);
  }

  const remaining = take - ids.length;
  if (remaining > 0) {
    const statementlessOrders = await prisma.order.findMany({
      where: {
        ...where,
        profitStatements: {
          // Same predicate as segment 1's aggregate (view + organizationId + storeId),
          // so the two segments partition order.count(where) without overlap or gap.
          none: { view: ProfitStatementView.BEST_KNOWN, organizationId: orgId, storeId },
        },
      },
      orderBy: [{ id: 'desc' }],
      skip: Math.max(0, skip - segment1Count),
      take: remaining,
      select: { id: true },
    });
    for (const order of statementlessOrders) ids.push(order.id);
  }

  return ids;
}

/** Load the page's rows for a margin sort by id, preserving the paged id order. */
async function loadOrdersByMargin(
  orgId: string,
  storeId: string,
  where: Prisma.OrderWhereInput,
  sort: Prisma.SortOrder,
  skip: number,
  take: number,
): Promise<OrderListRow[]> {
  const ids = await listOrderIdsByMargin(orgId, storeId, where, sort, skip, take);
  if (ids.length === 0) return [];

  const rows = await prisma.order.findMany({
    where: { id: { in: ids }, organizationId: orgId, storeId },
    include: orderListInclude(orgId),
  });

  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered: OrderListRow[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row !== undefined) ordered.push(row);
  }
  return ordered;
}

function fetchOrderListRows(
  orgId: string,
  storeId: string,
  where: Prisma.OrderWhereInput,
  sort: OrderListSort,
  skip: number,
  take: number,
): Promise<OrderListRow[]> {
  switch (sort) {
    case '-orderDate':
      return prisma.order.findMany({
        where,
        orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
        skip,
        take,
        include: orderListInclude(orgId),
      });
    case 'marginPct':
      return loadOrdersByMargin(orgId, storeId, where, 'asc', skip, take);
    case '-marginPct':
      return loadOrdersByMargin(orgId, storeId, where, 'desc', skip, take);
    default: {
      const _exhaustive: never = sort;
      throw new Error(`Unhandled order sort: ${_exhaustive}`);
    }
  }
}

// The list service accepts any positive page size for internal paging; the
// route's Zod schema (TABLE_PER_PAGE_OPTIONS) is the wire-level perPage
// whitelist, so a validated ListOrdersQuery is always assignable here.
type OrderListParams = Omit<ListOrdersQuery, 'perPage'> & { perPage: number };

export async function listOrders(
  orgId: string,
  storeId: string,
  filters: OrderListParams,
): Promise<OrderListResult> {
  await ensureStoreInOrg(orgId, storeId);

  const where = buildOrderListWhere(orgId, storeId, filters);
  const baseWhere = buildOrderListWhere(orgId, storeId, { ...filters, costStatus: undefined });
  const skip = (filters.page - 1) * filters.perPage;

  const [rows, total, calculatedCount, excludedCount] = await Promise.all([
    fetchOrderListRows(orgId, storeId, where, filters.sort, skip, filters.perPage),
    prisma.order.count({ where }),
    // Tabs count from the exclusion stamp (decision 3): calculated = not stamped,
    // excluded = stamped — honoring the sibling filters but ignoring costStatus.
    prisma.order.count({ where: { ...baseWhere, profitExcludedAt: null } }),
    prisma.order.count({ where: { ...baseWhere, profitExcludedAt: { not: null } } }),
  ]);

  const data: OrderListItemResponse[] = rows.map((row) => toOrderListItem(row));

  return { data, total, counts: { calculated: calculatedCount, excluded: excludedCount } };
}

/** The existing AND conditions of a where, normalized to an array to extend. */
function whereAndConditions(where: Prisma.OrderWhereInput): Prisma.OrderWhereInput[] {
  if (Array.isArray(where.AND)) return where.AND;
  if (where.AND === undefined) return [];
  return [where.AND];
}

/**
 * Filter-aware KPI aggregation for the orders page header. Honors the same
 * filters as listOrders (no pagination/sort). Revenue, net profit and the loss
 * rate read the best-known statements (decisions 1 + 4); a non-cancelled order
 * with no best-known statement contributes its own sale_gross as the revenue
 * fallback. Four aggregates run in parallel.
 */
export async function getOrdersSummary(
  orgId: string,
  storeId: string,
  filters: OrderSummaryQuery,
): Promise<OrderSummaryResult> {
  await ensureStoreInOrg(orgId, storeId);
  const where = buildOrderListWhere(orgId, storeId, filters);

  const bestKnownStatementWhere: Prisma.OrderProfitStatementWhereInput = {
    view: ProfitStatementView.BEST_KNOWN,
    organizationId: orgId,
    storeId,
    order: { is: where },
  };

  // Revenue fallback: orders in scope that are not cancelled and have no
  // best-known statement contribute their own sale_gross (decision 4). The
  // extra conditions go into AND so the status/costStatus filters still apply.
  // The writer persists an order's ESTIMATE and BEST_KNOWN statements together in
  // one transaction, so an order with an estimate but no best-known statement can
  // never exist: "no best-known statement" means "no statement at all", so this
  // fallback and the best-known aggregate partition the orders exactly once. The
  // none filter carries storeId too, matching segment 1's aggregate predicate.
  const fallbackRevenueWhere: Prisma.OrderWhereInput = {
    ...where,
    AND: [
      ...whereAndConditions(where),
      { status: { not: OrderStatus.CANCELLED } },
      {
        profitStatements: {
          none: { view: ProfitStatementView.BEST_KNOWN, organizationId: orgId, storeId },
        },
      },
    ],
  };

  const [totalCount, aggregate, lossCount, fallbackRevenue] = await Promise.all([
    prisma.order.count({ where }),
    prisma.orderProfitStatement.aggregate({
      where: bestKnownStatementWhere,
      _sum: { saleGross: true, netProfit: true },
      _avg: { saleMarginPct: true },
    }),
    prisma.orderProfitStatement.count({
      where: { ...bestKnownStatementWhere, netProfit: { lt: 0 } },
    }),
    prisma.order.aggregate({ where: fallbackRevenueWhere, _sum: { saleGross: true } }),
  ]);

  const bestKnownRevenue = new Decimal(aggregate._sum.saleGross?.toString() ?? '0');
  const fallback = new Decimal(fallbackRevenue._sum.saleGross?.toString() ?? '0');
  const netProfit = new Decimal(aggregate._sum.netProfit?.toString() ?? '0');
  const avgMargin = aggregate._avg.saleMarginPct;

  const pct = totalCount === 0 ? new Decimal(0) : new Decimal(lossCount).div(totalCount).mul(100);

  return {
    totalRevenueGross: bestKnownRevenue.add(fallback).toString(),
    netProfitGross: netProfit.toString(),
    // Round the averaged margin to the stored column scale (4 decimals, half-up) so
    // the aggregate reads the same scale as every per-statement margin the list shows.
    avgMarginPct:
      avgMargin === null ? null : roundPercent(new Decimal(avgMargin.toString())).toString(),
    lossOrderRate: { lossCount, totalCount, pct: pct.toString() },
  };
}

/**
 * The statement columns the order detail reads: the list projection's fields plus the
 * breakdown totals and the stored issues. A superset of STATEMENT_LIST_SELECT, so the
 * same rows feed both toStatementPair (the profit fields) and statementTotalsFromRow
 * (the breakdown totals). Store-scoped reads filter these by organizationId + storeId.
 */
const DETAIL_STATEMENT_SELECT = {
  view: true,
  status: true,
  reconciliationStatus: true,
  issues: true,
  ...STORED_STATEMENT_TOTALS_SELECT,
} as const satisfies Prisma.OrderProfitStatementSelect;

type DetailStatementRow = Prisma.OrderProfitStatementGetPayload<{
  select: typeof DETAIL_STATEMENT_SELECT;
}>;

/** The two view selections and the best-known issues an order's item values read. */
interface OrderProfitLineContext {
  readonly bestKnownLines: readonly ProfitLine[];
  readonly estimateLines: readonly ProfitLine[];
  readonly issues: readonly ProfitIssue[];
}

/**
 * Everything the order detail needs from the profit layer: the profit fields
 * (reconciliation status, estimated / settled net profit), the best-known breakdown,
 * and the per-item line context. lineContext is null only when the engine cannot
 * compute this platform's profit at all, in which case every item falls back to its
 * own columns and the value-only figures are null.
 */
interface OrderProfitDetail {
  readonly fields: OrderProfitFields;
  readonly profitBreakdown: StatementBreakdown | null;
  readonly lineContext: OrderProfitLineContext | null;
}

/** The all-null item values for a platform whose profit the engine cannot compute. */
const EMPTY_ITEM_PROFIT_VALUES: ItemProfitValues = {
  unitCostGross: null,
  unitCostVatRate: null,
  commissionGross: null,
  commissionRate: null,
  estimatedCommissionGross: null,
  settledCommissionGross: null,
};

/**
 * Projects an in-request computed statement into the list-row shape orderProfitFields
 * reads, rounding the two margins to the stored column scale exactly as the writer
 * would, so the computed path reports the same fields a stored row would.
 */
function statementListRowFromStatement(statement: ProfitStatement): StatementListRow {
  return {
    view: statement.view,
    status: statement.status,
    saleGross: statement.saleGross,
    netProfit: statement.netProfit,
    saleMarginPct: statement.saleMarginPct === null ? null : roundPercent(statement.saleMarginPct),
    costMarkupPct: statement.costMarkupPct === null ? null : roundPercent(statement.costMarkupPct),
    reconciliationStatus: statement.reconciliationStatus,
  };
}

/**
 * Loads the order's profit detail from its two stored statements and lines, or computes
 * it in the request when no best-known statement is stored yet (decision 8). The writer
 * persists the estimate and best-known views together, so a missing best-known row means
 * no statement at all; computeParcelProfit then produces both views read-only. Only an
 * UnsupportedPlatformError is expected from it (a platform the engine cannot compute):
 * the detail then keeps its profit fields empty and its breakdown null; every other
 * error propagates. Every query filters organizationId + storeId (tenant defense).
 */
async function loadOrderProfitDetail(
  orgId: string,
  storeId: string,
  order: {
    readonly id: string;
    readonly status: OrderStatus;
    readonly saleGross: Prisma.Decimal | null;
    readonly listGross: Prisma.Decimal | null;
    readonly sellerDiscountGross: Prisma.Decimal | null;
  },
): Promise<OrderProfitDetail> {
  const [statements, linesByOrder] = await Promise.all([
    prisma.orderProfitStatement.findMany({
      where: { organizationId: orgId, storeId, orderId: order.id },
      select: DETAIL_STATEMENT_SELECT,
    }),
    loadOrderProfitLines(prisma, {
      organizationId: orgId,
      storeId,
      orderIds: [order.id],
    }),
  ]);
  const lines = linesByOrder.get(order.id) ?? [];

  const listGross = new Decimal(order.listGross?.toString() ?? '0');
  const sellerDiscountGross = new Decimal(order.sellerDiscountGross?.toString() ?? '0');

  let bestKnownRow: DetailStatementRow | null = null;
  for (const statement of statements) {
    if (statement.view === ProfitStatementView.BEST_KNOWN) {
      bestKnownRow = statement;
    }
  }

  if (bestKnownRow !== null) {
    const fields = orderProfitFields({
      pair: toStatementPair(statements),
      orderStatus: order.status,
      orderSaleGross: order.saleGross,
    });
    const lineContext: OrderProfitLineContext = {
      bestKnownLines: selectLines(lines, 'BEST_KNOWN'),
      estimateLines: selectLines(lines, 'ESTIMATE'),
      issues: parseStoredIssues(bestKnownRow.issues),
    };
    const profitBreakdown = buildStatementBreakdown({
      totals: statementTotalsFromRow(bestKnownRow),
      selectedLines: lineContext.bestKnownLines,
      listGross,
      sellerDiscountGross,
    });
    return { fields, profitBreakdown, lineContext };
  }

  // No best-known statement stored yet: compute read-only in the request (owner decision
  // 2026-11-04 / decision 8). computeParcelProfitForRead returns null -- no profit at all
  // -- for a platform the engine cannot compute and for any computation failure (the
  // latter is logged), so the detail still opens with an empty profit section.
  const computed = await computeParcelProfitForRead({
    organizationId: orgId,
    orderId: order.id,
    surface: 'order-detail',
  });
  if (computed === null) {
    return {
      fields: orderProfitFields({
        pair: { estimate: null, bestKnown: null },
        orderStatus: order.status,
        orderSaleGross: order.saleGross,
      }),
      profitBreakdown: null,
      lineContext: null,
    };
  }

  const fields = orderProfitFields({
    pair: {
      estimate: statementListRowFromStatement(computed.estimate),
      bestKnown: statementListRowFromStatement(computed.bestKnown),
    },
    orderStatus: order.status,
    orderSaleGross: order.saleGross,
  });
  const profitBreakdown = buildStatementBreakdown({
    totals: statementTotalsFromStatement(computed.bestKnown),
    selectedLines: computed.bestKnown.selectedLines,
    listGross,
    sellerDiscountGross,
  });
  return {
    fields,
    profitBreakdown,
    lineContext: {
      bestKnownLines: computed.bestKnown.selectedLines,
      estimateLines: computed.estimate.selectedLines,
      issues: computed.bestKnown.issues,
    },
  };
}

export async function getOrderById(
  orgId: string,
  storeId: string,
  orderId: string,
): Promise<OrderDetailResponse> {
  await ensureStoreInOrg(orgId, storeId);

  const row = await prisma.order.findFirst({
    where: { id: orderId, organizationId: orgId, storeId },
    include: {
      store: { select: { id: true, name: true, platform: true } },
      items: {
        orderBy: { id: 'asc' },
        include: {
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
      },
      claims: {
        orderBy: { claimDate: 'asc' },
        include: {
          items: { orderBy: { id: 'asc' } },
        },
      },
    },
  });

  if (row === null) {
    throw new NotFoundError('Order', orderId);
  }

  // vendorMissing: unmatched lines (productVariantId null) whose barcode is a
  // confirmed catalog gap — the seller should see "Trendyol kataloğunda yok"
  // rather than "eşleşme bekliyor". Backend derives it (the frontend never
  // computes it); meaningful only for unmatched lines, false for matched ones.
  // One batched query over the distinct unmatched barcodes — no N+1.
  const vendorMissingBarcodes = await resolveVendorMissingBarcodes(
    orgId,
    storeId,
    row.items.flatMap((item) =>
      item.productVariant === null && item.barcode !== null ? [item.barcode] : [],
    ),
  );

  // The profit fields, the breakdown and the per-item cost/commission values all read
  // the order's profit statements and lines (decisions 1, 6-8). When no best-known
  // statement is stored yet, loadOrderProfitDetail computes them read-only in the
  // request. The legacy order columns and order_fees are no longer read here.
  const profit = await loadOrderProfitDetail(orgId, storeId, row);

  return {
    id: row.id,
    organizationId: row.organizationId,
    storeId: row.storeId,
    store: {
      id: row.store.id,
      name: row.store.name,
      platform: row.store.platform,
    },

    platformOrderId: row.platformOrderId,
    platformOrderNumber: row.platformOrderNumber,

    orderDate: row.orderDate.toISOString(),
    status: row.status,

    agreedDeliveryDate: row.agreedDeliveryDate?.toISOString() ?? null,
    actualDeliveryDate: row.actualDeliveryDate?.toISOString() ?? null,
    deliveredOnTime: row.deliveredOnTime,
    fastDelivery: row.fastDelivery,
    micro: row.micro,

    // Sale parity: the detail's top-level sale reads the same profit field the list row
    // does (best-known sale, else the order's sale, '0' for a cancelled order with no
    // statement), so an order with a return never shows two different sale figures.
    saleGross: profit.fields.saleGross,
    saleVat: row.saleVat?.toString() ?? null,
    listGross: row.listGross?.toString() ?? null,
    estimatedNetProfit: profit.fields.estimatedNetProfit,
    settledNetProfit: profit.fields.settledNetProfit,
    profitBreakdown: profit.profitBreakdown,
    promotionDisplays: toPromotionDisplays(row.promotionDisplays),

    profitExcludedAt: row.profitExcludedAt?.toISOString() ?? null,
    profitExclusionReason: row.profitExclusionReason,

    reconciliationStatus: profit.fields.reconciliationStatus,
    // fees[] is always empty and paymentOrderId/paymentDate always null in the wire
    // contract now (Faz 4A decision 9); both fall away entirely in Faz 5.
    paymentOrderId: null,
    paymentDate: null,

    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),

    items: row.items.map((item) => {
      // Cost and commission figures come from the profit lines (decision 7); the
      // commission amount and rate fall back to the item's own columns when no line
      // supplies them. An unsupported platform leaves every figure null/column.
      const values =
        profit.lineContext === null
          ? EMPTY_ITEM_PROFIT_VALUES
          : itemProfitValues({
              orderItemId: item.id,
              quantity: item.quantity,
              bestKnownLines: profit.lineContext.bestKnownLines,
              estimateLines: profit.lineContext.estimateLines,
              issues: profit.lineContext.issues,
            });
      return {
        id: item.id,
        quantity: item.quantity,
        lineSaleGross: item.lineSaleGross.toString(),
        saleVatRate: item.saleVatRate.toString(),
        lineSellerDiscountGross: item.lineSellerDiscountGross.toString(),
        commissionGross: values.commissionGross ?? item.commissionGross.toString(),
        commissionRate: values.commissionRate ?? item.commissionRate.toString(),
        commissionVatRate: item.commissionVatRate.toString(),
        refundedCommissionGross: item.refundedCommissionGross.toString(),
        estimatedCommissionGross: values.estimatedCommissionGross,
        settledCommissionGross: values.settledCommissionGross,
        unitCostSnapshotGross: values.unitCostGross,
        unitCostSnapshotVatRate: values.unitCostVatRate,
        commissionInvoiceSerialNumber: null,
        barcode: item.barcode,
        // Only an unmatched line (no variant) with a confirmed catalog gap is true;
        // matched lines are always false.
        vendorMissing:
          item.productVariant === null &&
          item.barcode !== null &&
          vendorMissingBarcodes.has(item.barcode),
        variant:
          item.productVariant === null
            ? null
            : {
                id: item.productVariant.id,
                barcode: item.productVariant.barcode,
                productName: item.productVariant.product.title,
                productImageUrl: item.productVariant.product.imageUrls[0] ?? null,
                marketplaceProductCode: item.productVariant.stockCode,
              },
      };
    }),

    // Always empty in the wire contract now (decision 9); the fee timeline falls away
    // in Faz 5.
    fees: [],

    claims: row.claims.map((claim) => ({
      id: claim.id,
      trendyolClaimId: claim.trendyolClaimId,
      claimDate: claim.claimDate.toISOString(),
      cargoProviderName: claim.cargoProviderName,
      cargoTrackingNumber: claim.cargoTrackingNumber?.toString() ?? null,
      resolved: claim.resolved,
      items: claim.items.map((item) => ({
        id: item.id,
        orderItemId: item.orderItemId,
        reasonCode: item.reasonCode,
        reasonName: item.reasonName,
        status: item.status,
        acceptedBySeller: item.acceptedBySeller,
        resolved: item.resolved,
      })),
    })),
  };
}
