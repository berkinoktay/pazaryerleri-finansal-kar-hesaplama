import type { Prisma } from '@pazarsync/db';
import { prisma } from '@pazarsync/db';

import { NotFoundError } from '../lib/errors';
import type {
  ListOrdersQuery,
  OrderDetailResponse,
  OrderListItemResponse,
} from '../validators/order.validator';

interface OrderListResult {
  data: OrderListItemResponse[];
  total: number;
  counts: { calculated: number; pending: number };
}

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
  filters: ListOrdersQuery,
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

  if (filters.costStatus !== undefined) {
    where.estimatedNetProfit = filters.costStatus === 'calculated' ? { not: null } : null;
  }

  return where;
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

  const [rows, total, calculatedCount, pendingCount] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
      skip,
      take: filters.perPage,
      include: {
        _count: { select: { items: true } },
      },
    }),
    prisma.order.count({ where }),
    prisma.order.count({ where: { ...baseWhere, estimatedNetProfit: { not: null } } }),
    prisma.order.count({ where: { ...baseWhere, estimatedNetProfit: null } }),
  ]);

  const data: OrderListItemResponse[] = rows.map((row) => ({
    id: row.id,
    platformOrderId: row.platformOrderId,
    platformOrderNumber: row.platformOrderNumber,
    orderDate: row.orderDate.toISOString(),
    status: row.status,
    reconciliationStatus: row.reconciliationStatus,
    saleSubtotalNet: row.saleSubtotalNet?.toString() ?? null,
    saleVatTotal: row.saleVatTotal?.toString() ?? null,
    estimatedNetProfit: row.estimatedNetProfit?.toString() ?? null,
    settledNetProfit: row.settledNetProfit?.toString() ?? null,
    fastDelivery: row.fastDelivery,
    micro: row.micro,
    itemCount: row._count.items,
  }));

  return { data, total, counts: { calculated: calculatedCount, pending: pendingCount } };
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

    saleSubtotalNet: row.saleSubtotalNet?.toString() ?? null,
    saleVatTotal: row.saleVatTotal?.toString() ?? null,
    estimatedNetProfit: row.estimatedNetProfit?.toString() ?? null,
    settledNetProfit: row.settledNetProfit?.toString() ?? null,

    reconciliationStatus: row.reconciliationStatus,
    paymentOrderId: row.paymentOrderId?.toString() ?? null,
    paymentDate: row.paymentDate?.toISOString() ?? null,

    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),

    items: row.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      unitPriceNet: item.unitPriceNet?.toString() ?? null,
      unitVatRate: item.unitVatRate?.toString() ?? null,
      unitVatAmount: item.unitVatAmount?.toString() ?? null,
      grossCommissionAmountNet: item.grossCommissionAmountNet.toString(),
      grossCommissionVatAmount: item.grossCommissionVatAmount.toString(),
      refundedCommissionAmountNet: item.refundedCommissionAmountNet.toString(),
      refundedCommissionVatAmount: item.refundedCommissionVatAmount.toString(),
      sellerDiscountNet: item.sellerDiscountNet.toString(),
      sellerDiscountVatAmount: item.sellerDiscountVatAmount.toString(),
      unitCostSnapshotNet: item.unitCostSnapshotNet?.toString() ?? null,
      unitCostSnapshotVatRate: item.unitCostSnapshotVatRate?.toString() ?? null,
      unitCostSnapshotVatAmount: item.unitCostSnapshotVatAmount?.toString() ?? null,
      commissionInvoiceSerialNumber: item.commissionInvoiceSerialNumber,
      barcode: item.barcode,
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
      amountNet: fee.amountNet.toString(),
      vatRate: fee.vatRate.toString(),
      vatAmount: fee.vatAmount.toString(),
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
