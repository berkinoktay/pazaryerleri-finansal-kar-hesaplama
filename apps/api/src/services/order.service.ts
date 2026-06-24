import type { Prisma } from '@pazarsync/db';
import { prisma } from '@pazarsync/db';
import { buildProfitBreakdown } from '@pazarsync/profit';
import { Decimal } from 'decimal.js';

import { resolveVendorMissingBarcodes } from '../lib/catalog-barcode-miss-lookup';
import { NotFoundError } from '../lib/errors';
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

function buildOrderListWhere(
  orgId: string,
  storeId: string,
  filters: OrderListFilters,
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {
    organizationId: orgId,
    storeId,
  };

  if (filters.status !== undefined) where.status = filters.status;
  if (filters.reconciliationStatus !== undefined) {
    where.reconciliationStatus = filters.reconciliationStatus;
  }

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

  // Calculated-or-excluded (spec 2026-06-12): the segment key is the exclusion
  // stamp, not "estimate still null" — there is no pending state anymore.
  if (filters.costStatus !== undefined) {
    if (filters.costStatus === 'calculated') {
      where.estimatedNetProfit = { not: null };
    } else {
      where.profitExcludedAt = { not: null };
    }
  }

  // "Sadece zararlı": consumed net kâr (settled ?? estimated) < 0. Prisma coalesce
  // desteklemediği için OR; q filtresi where.OR'u kullandığından AND ile birleştir.
  if (filters.lossOnly === true) {
    const lossCondition: Prisma.OrderWhereInput = {
      OR: [
        { settledNetProfit: { lt: 0 } },
        { settledNetProfit: null, estimatedNetProfit: { lt: 0 } },
      ],
    };
    where.AND = Array.isArray(where.AND)
      ? [...where.AND, lossCondition]
      : where.AND === undefined
        ? [lossCondition]
        : [where.AND, lossCondition];
  }

  return where;
}

/**
 * Map the sort key to a Prisma orderBy. Every branch appends a stable `id`
 * tiebreaker so pagination is deterministic when the lead column ties (e.g.
 * many orders share the same margin). Margin sorts push null margins to the
 * end in BOTH directions so unscored orders never crowd the top.
 */
function buildOrderListOrderBy(sort: OrderListSort): Prisma.OrderOrderByWithRelationInput[] {
  switch (sort) {
    case '-orderDate':
      return [{ orderDate: 'desc' }, { id: 'desc' }];
    case 'marginPct':
      return [{ estimatedSaleMarginPct: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }];
    case '-marginPct':
      return [{ estimatedSaleMarginPct: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }];
    default: {
      const _exhaustive: never = sort;
      throw new Error(`Unhandled order sort: ${_exhaustive}`);
    }
  }
}

export async function listOrders(
  orgId: string,
  storeId: string,
  filters: ListOrdersQuery,
): Promise<OrderListResult> {
  await ensureStoreInOrg(orgId, storeId);

  const where = buildOrderListWhere(orgId, storeId, filters);
  const baseWhere = buildOrderListWhere(orgId, storeId, { ...filters, costStatus: undefined });
  const skip = (filters.page - 1) * filters.perPage;

  const [rows, total, calculatedCount, excludedCount] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: buildOrderListOrderBy(filters.sort),
      skip,
      take: filters.perPage,
      include: {
        _count: { select: { items: true } },
      },
    }),
    prisma.order.count({ where }),
    prisma.order.count({ where: { ...baseWhere, estimatedNetProfit: { not: null } } }),
    prisma.order.count({ where: { ...baseWhere, profitExcludedAt: { not: null } } }),
  ]);

  const data: OrderListItemResponse[] = rows.map((row) => ({
    id: row.id,
    platformOrderId: row.platformOrderId,
    platformOrderNumber: row.platformOrderNumber,
    orderDate: row.orderDate.toISOString(),
    status: row.status,
    reconciliationStatus: row.reconciliationStatus,
    saleGross: row.saleGross?.toString() ?? null,
    saleVat: row.saleVat?.toString() ?? null,
    listGross: row.listGross?.toString() ?? null,
    estimatedNetProfit: row.estimatedNetProfit?.toString() ?? null,
    settledNetProfit: row.settledNetProfit?.toString() ?? null,
    // Consumed marj: hakediş gerçeği varsa onu, yoksa T+0 tahminini servis et.
    // Frontend SADECE render eder (render-time hesap yok).
    saleMarginPct: (row.settledSaleMarginPct ?? row.estimatedSaleMarginPct)?.toString() ?? null,
    // ROI (consumed): settled ?? estimated cost-markup; frontend türetmez, render eder.
    costMarkupPct: (row.settledCostMarkupPct ?? row.estimatedCostMarkupPct)?.toString() ?? null,
    // Promosyon adları (spec ekleme #3): detaydakiyle aynı runtime-doğrulamalı
    // dönüşüm — liste satırı indirimin hangi promosyondan geldiğini gösterir.
    promotionDisplays: toPromotionDisplays(row.promotionDisplays),
    fastDelivery: row.fastDelivery,
    micro: row.micro,
    itemCount: row._count.items,
  }));

  return { data, total, counts: { calculated: calculatedCount, excluded: excludedCount } };
}

/**
 * Filter-aware KPI aggregation for the orders page header. Honors the same
 * filters as listOrders (no pagination/sort). Revenue + counts use Prisma
 * aggregate; consumed net profit / margin use a column projection reduced with
 * Decimal (Prisma can't COALESCE in aggregate). Bounded by the store + date
 * filter; if a very large unfiltered range becomes a hotspot, move the coalesce
 * sums to a $queryRaw SUM(COALESCE(...)).
 */
export async function getOrdersSummary(
  orgId: string,
  storeId: string,
  filters: OrderSummaryQuery,
): Promise<OrderSummaryResult> {
  await ensureStoreInOrg(orgId, storeId);
  const where = buildOrderListWhere(orgId, storeId, filters);

  const lossCondition: Prisma.OrderWhereInput = {
    OR: [
      { settledNetProfit: { lt: 0 } },
      { settledNetProfit: null, estimatedNetProfit: { lt: 0 } },
    ],
  };
  const lossWhere: Prisma.OrderWhereInput = {
    ...where,
    AND: [
      ...(Array.isArray(where.AND) ? where.AND : where.AND !== undefined ? [where.AND] : []),
      lossCondition,
    ],
  };

  const [agg, totalCount, lossCount, profitRows] = await Promise.all([
    prisma.order.aggregate({ where, _sum: { saleGross: true } }),
    prisma.order.count({ where }),
    prisma.order.count({ where: lossWhere }),
    prisma.order.findMany({
      where,
      select: {
        settledNetProfit: true,
        estimatedNetProfit: true,
        settledSaleMarginPct: true,
        estimatedSaleMarginPct: true,
      },
    }),
  ]);

  const netProfit = profitRows.reduce((sum, row) => {
    const value = row.settledNetProfit ?? row.estimatedNetProfit;
    return value === null ? sum : sum.add(new Decimal(value.toString()));
  }, new Decimal(0));

  const margins = profitRows
    .map((row) => row.settledSaleMarginPct ?? row.estimatedSaleMarginPct)
    .filter((margin): margin is NonNullable<typeof margin> => margin !== null)
    .map((margin) => new Decimal(margin.toString()));
  const avgMargin =
    margins.length === 0
      ? null
      : margins.reduce((sum, margin) => sum.add(margin), new Decimal(0)).div(margins.length);

  const pct = totalCount === 0 ? new Decimal(0) : new Decimal(lossCount).div(totalCount).mul(100);

  return {
    totalRevenueGross: (agg._sum.saleGross ?? new Decimal(0)).toString(),
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
                  images: {
                    orderBy: { position: 'asc' },
                    take: 1,
                    select: { url: true },
                  },
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
              productImageUrl: item.productVariant.product.images[0]?.url ?? null,
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
