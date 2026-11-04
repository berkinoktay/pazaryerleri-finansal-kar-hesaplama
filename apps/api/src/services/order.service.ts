import type { Prisma } from '@pazarsync/db';
import { prisma } from '@pazarsync/db';
import { OrderStatus, ProfitStatementView, ReconciliationStatus } from '@pazarsync/db/enums';
import { buildProfitBreakdown } from '@pazarsync/profit';
import { Decimal } from 'decimal.js';

import { resolveVendorMissingBarcodes } from '../lib/catalog-barcode-miss-lookup';
import { NotFoundError } from '../lib/errors';
import {
  STATEMENT_LIST_SELECT,
  orderProfitFields,
  toStatementPair,
} from '../lib/order-profit-fields';
import { toPromotionDisplays } from '../lib/promotion-displays';
import type {
  ListOrdersQuery,
  OrderDetailResponse,
  OrderListItemResponse,
  OrderListSort,
  OrderSummaryQuery,
} from '../validators/order.validator';

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
  if (reconciliationStatus === ReconciliationStatus.NOT_SETTLED) {
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
  }
  return {
    profitStatements: {
      some: {
        view: ProfitStatementView.BEST_KNOWN,
        organizationId: orgId,
        reconciliationStatus,
      },
    },
  };
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
    where.profitExcludedAt = filters.costStatus === 'calculated' ? null : { not: null };
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
          none: { view: ProfitStatementView.BEST_KNOWN, organizationId: orgId },
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
  const fallbackRevenueWhere: Prisma.OrderWhereInput = {
    ...where,
    AND: [
      ...whereAndConditions(where),
      { status: { not: OrderStatus.CANCELLED } },
      {
        profitStatements: {
          none: { view: ProfitStatementView.BEST_KNOWN, organizationId: orgId },
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
    avgMarginPct: avgMargin === null ? null : avgMargin.toString(),
    lossOrderRate: { lossCount, totalCount, pct: pct.toString() },
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
      fees: {
        orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
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

  // Kâr dökümü (tahmini basis) — backend-hesaplı, frontend türetmez. GROSS
  // konvansiyon: computeProfit'in persist ettiği netProfit/netVat + kalıcı gross
  // marjlar + ESTIMATE fee'lerden brüt toplamlar. Estimate hesaplanmadıysa
  // (profit-excluded / maliyet eksik) null. buildProfitBreakdown marjı '—'
  // (em-dash) sentinel olarak döndürür; wire kontratı gerçek null taşır.
  const profitBreakdown =
    row.estimatedNetProfit !== null &&
    row.estimatedNetVat !== null &&
    row.saleGross !== null &&
    row.saleVat !== null
      ? buildProfitBreakdown({
          saleGross: new Decimal(row.saleGross.toString()),
          saleVat: new Decimal(row.saleVat.toString()),
          listGross: new Decimal(row.listGross?.toString() ?? '0'),
          sellerDiscountGross: new Decimal(row.sellerDiscountGross?.toString() ?? '0'),
          items: row.items.map((item) => ({
            quantity: item.quantity,
            lineListGross: new Decimal(item.lineListGross.toString()),
            lineSaleGross: new Decimal(item.lineSaleGross.toString()),
            lineSellerDiscountGross: new Decimal(item.lineSellerDiscountGross.toString()),
            saleVatRate: Number(item.saleVatRate),
            commissionGross: new Decimal(item.commissionGross.toString()),
            refundedCommissionGross: new Decimal(item.refundedCommissionGross.toString()),
            commissionVatRate: Number(item.commissionVatRate),
            unitCostSnapshotGross:
              item.unitCostSnapshotGross === null
                ? null
                : new Decimal(item.unitCostSnapshotGross.toString()),
            unitCostSnapshotVatRate: Number(item.unitCostSnapshotVatRate ?? 0),
          })),
          // Breakdown estimated kârla eşleşir (netProfit: estimatedNetProfit aşağıda).
          // Forward fee'ler (SHIPPING/PSF/STOPPAGE) YALNIZ ESTIMATE kaynağından alınır —
          // estimate motorunun (applyEstimateOnOrderCreate) kullandığıyla birebir; aksi
          // halde feeAgg, cargo-invoice geldikten sonra gerçek+tahmin forward'ı ÇİFT sayar.
          // İade bacakları (4 tip) TÜM kaynaklardan geçer; resolveReturnLegs (breakdown
          // içinde) per-leg gerçek-varsa-gerçek seçer (estimate motoruyla aynı).
          fees: row.fees
            .filter(
              (fee) =>
                fee.source === 'ESTIMATE' ||
                fee.feeType === 'REFUND_DEDUCTION' ||
                fee.feeType === 'COMMISSION_REFUND' ||
                fee.feeType === 'COST_RETURN' ||
                fee.feeType === 'RETURN_SHIPPING' ||
                fee.feeType === 'STOPPAGE_REFUND',
            )
            .map((fee) => ({
              feeType: fee.feeType,
              direction: fee.direction,
              amountGross: new Decimal(fee.amountGross.toString()),
              vatRate: Number(fee.vatRate),
              source: fee.source,
            })),
          netProfit: new Decimal(row.estimatedNetProfit.toString()),
          netVat: new Decimal(row.estimatedNetVat.toString()),
          saleMarginPct:
            row.estimatedSaleMarginPct === null
              ? null
              : new Decimal(row.estimatedSaleMarginPct.toString()),
          costMarkupPct:
            row.estimatedCostMarkupPct === null
              ? null
              : new Decimal(row.estimatedCostMarkupPct.toString()),
        })
      : null;

  // buildProfitBreakdown marjı '—' sentinel'i ile döndürür; wire kontratı gerçek
  // null taşır (frontend `=== null ? '—'` ile render eder, türetmez).
  const profitBreakdownWire =
    profitBreakdown === null
      ? null
      : {
          ...profitBreakdown,
          saleMarginPct:
            profitBreakdown.saleMarginPct === '—' ? null : profitBreakdown.saleMarginPct,
          costMarkupPct:
            profitBreakdown.costMarkupPct === '—' ? null : profitBreakdown.costMarkupPct,
        };

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

    saleGross: row.saleGross?.toString() ?? null,
    saleVat: row.saleVat?.toString() ?? null,
    listGross: row.listGross?.toString() ?? null,
    estimatedNetProfit: row.estimatedNetProfit?.toString() ?? null,
    settledNetProfit: row.settledNetProfit?.toString() ?? null,
    profitBreakdown: profitBreakdownWire,
    promotionDisplays: toPromotionDisplays(row.promotionDisplays),

    profitExcludedAt: row.profitExcludedAt?.toISOString() ?? null,
    profitExclusionReason: row.profitExclusionReason,

    reconciliationStatus: row.reconciliationStatus,
    paymentOrderId: row.paymentOrderId?.toString() ?? null,
    paymentDate: row.paymentDate?.toISOString() ?? null,

    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),

    items: row.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      lineSaleGross: item.lineSaleGross.toString(),
      saleVatRate: item.saleVatRate.toString(),
      lineSellerDiscountGross: item.lineSellerDiscountGross.toString(),
      commissionGross: item.commissionGross.toString(),
      commissionRate: item.commissionRate.toString(),
      commissionVatRate: item.commissionVatRate.toString(),
      refundedCommissionGross: item.refundedCommissionGross.toString(),
      estimatedCommissionGross: item.estimatedCommissionGross?.toString() ?? null,
      settledCommissionGross: item.settledCommissionGross?.toString() ?? null,
      unitCostSnapshotGross: item.unitCostSnapshotGross?.toString() ?? null,
      unitCostSnapshotVatRate: item.unitCostSnapshotVatRate?.toString() ?? null,
      commissionInvoiceSerialNumber: item.commissionInvoiceSerialNumber,
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
    })),

    fees: row.fees.map((fee) => ({
      id: fee.id,
      feeType: fee.feeType,
      source: fee.source,
      direction: fee.direction,
      amountGross: fee.amountGross.toString(),
      vatRate: fee.vatRate.toString(),
      // Tahmin/gerçek-fatura ayrımı: ESTIMATE = henüz vendor-onaylı değil.
      isEstimate: fee.source === 'ESTIMATE',
      displayName: fee.displayName,
      capturedAt: fee.capturedAt.toISOString(),
      confirmedAt: fee.confirmedAt?.toISOString() ?? null,
    })),

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
