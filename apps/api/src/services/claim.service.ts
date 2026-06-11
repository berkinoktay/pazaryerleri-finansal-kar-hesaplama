import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import { prisma } from '@pazarsync/db';

import { NotFoundError } from '../lib/errors';
import type { ClaimsSummaryQuery, ListClaimsQuery } from '../validators/claim.validator';
import {
  deriveClaimStatus,
  deriveProductSummary,
  deriveReasonSummary,
  deriveScope,
  type ClaimScope,
  type DerivedClaimStatus,
} from './claim-derive';

const SUMMARY_DEFAULT_PERIOD_DAYS = 30;
const RETURN_TRIO_FEE_TYPES = ['REFUND_DEDUCTION', 'COMMISSION_REFUND', 'COST_RETURN'] as const;

interface ClaimListItemResult {
  id: string;
  orderId: string;
  platformOrderNumber: string | null;
  trendyolClaimId: string;
  claimDate: string;
  resolved: boolean;
  derivedStatus: DerivedClaimStatus;
  scope: ClaimScope;
  itemCount: number;
  productSummary: { firstName: string | null; units: number; otherCount: number };
  reasonSummary: { first: string; otherCount: number };
  cargoProviderName: string | null;
  cargoTrackingNumber: string | null;
}

interface ClaimListResult {
  data: ClaimListItemResult[];
  total: number;
  counts: { all: number; open: number; resolved: number };
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

function buildClaimListWhere(
  orgId: string,
  storeId: string,
  filters: ListClaimsQuery,
): Prisma.OrderClaimWhereInput {
  const where: Prisma.OrderClaimWhereInput = {
    organizationId: orgId,
    storeId,
  };

  if (filters.status === 'open') where.resolved = false;
  if (filters.status === 'resolved') where.resolved = true;

  if (filters.from !== undefined || filters.to !== undefined) {
    where.claimDate = {
      ...(filters.from !== undefined ? { gte: filters.from } : {}),
      ...(filters.to !== undefined ? { lte: filters.to } : {}),
    };
  }

  if (filters.q !== undefined) {
    where.OR = [
      { trendyolClaimId: { contains: filters.q, mode: 'insensitive' } },
      { order: { platformOrderNumber: { contains: filters.q, mode: 'insensitive' } } },
    ];
  }

  return where;
}

export async function listClaims(
  orgId: string,
  storeId: string,
  filters: ListClaimsQuery,
): Promise<ClaimListResult> {
  await ensureStoreInOrg(orgId, storeId);

  const where = buildClaimListWhere(orgId, storeId, filters);
  const baseWhere = buildClaimListWhere(orgId, storeId, { ...filters, status: undefined });
  const skip = (filters.page - 1) * filters.perPage;

  const [rows, total, allCount, openCount, resolvedCount] = await Promise.all([
    prisma.orderClaim.findMany({
      where,
      orderBy: [{ claimDate: 'desc' }, { id: 'desc' }],
      skip,
      take: filters.perPage,
      include: {
        order: {
          select: {
            platformOrderNumber: true,
            items: { select: { quantity: true } },
          },
        },
        items: {
          orderBy: { id: 'asc' },
          select: {
            status: true,
            reasonName: true,
            orderItem: {
              select: {
                productVariant: {
                  select: { product: { select: { title: true } } },
                },
              },
            },
          },
        },
      },
    }),
    prisma.orderClaim.count({ where }),
    prisma.orderClaim.count({ where: baseWhere }),
    prisma.orderClaim.count({ where: { ...baseWhere, resolved: false } }),
    prisma.orderClaim.count({ where: { ...baseWhere, resolved: true } }),
  ]);

  const data: ClaimListItemResult[] = rows.map((row) => {
    const orderUnitTotal = row.order.items.reduce((sum, i) => sum + i.quantity, 0);
    return {
      id: row.id,
      orderId: row.orderId,
      platformOrderNumber: row.order.platformOrderNumber,
      trendyolClaimId: row.trendyolClaimId,
      claimDate: row.claimDate.toISOString(),
      resolved: row.resolved,
      derivedStatus: deriveClaimStatus(
        row.resolved,
        row.items.map((i) => i.status),
      ),
      scope: deriveScope(row.items.length, orderUnitTotal),
      itemCount: row.items.length,
      productSummary: deriveProductSummary(row.items),
      reasonSummary: deriveReasonSummary(row.items.map((i) => i.reasonName)),
      cargoProviderName: row.cargoProviderName,
      cargoTrackingNumber: row.cargoTrackingNumber?.toString() ?? null,
    };
  });

  return { data, total, counts: { all: allCount, open: openCount, resolved: resolvedCount } };
}

interface ClaimsSummaryResult {
  openCount: number;
  resolvedInPeriod: number;
  refundDeductionGross: string;
  commissionRefundGross: string;
  costReturnGross: string;
  netImpactGross: string;
}

export async function getClaimsSummary(
  orgId: string,
  storeId: string,
  range: ClaimsSummaryQuery,
): Promise<ClaimsSummaryResult> {
  await ensureStoreInOrg(orgId, storeId);

  // Count KPIs run on claimDate (when the claim was opened); financial KPIs
  // run on OrderFee.capturedAt (when the deduction hit the books) — each is
  // its own question's honest axis (spec §5.2).
  const to = range.to ?? new Date();
  const from =
    range.from ?? new Date(to.getTime() - SUMMARY_DEFAULT_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  const [openCount, resolvedInPeriod, feeGroups] = await Promise.all([
    prisma.orderClaim.count({
      where: { organizationId: orgId, storeId, resolved: false },
    }),
    prisma.orderClaim.count({
      where: { organizationId: orgId, storeId, resolved: true, claimDate: { gte: from, lte: to } },
    }),
    prisma.orderFee.groupBy({
      by: ['feeType'],
      where: {
        organizationId: orgId,
        source: 'SETTLEMENT',
        feeType: { in: [...RETURN_TRIO_FEE_TYPES] },
        capturedAt: { gte: from, lte: to },
        order: { storeId },
      },
      _sum: { amountNet: true, vatAmount: true },
    }),
  ]);

  const grossOf = (feeType: (typeof RETURN_TRIO_FEE_TYPES)[number]): Decimal => {
    const group = feeGroups.find((g) => g.feeType === feeType);
    const net = new Decimal(group?._sum.amountNet?.toString() ?? '0');
    const vat = new Decimal(group?._sum.vatAmount?.toString() ?? '0');
    return net.add(vat);
  };

  const refundDeduction = grossOf('REFUND_DEDUCTION');
  const commissionRefund = grossOf('COMMISSION_REFUND');
  const costReturn = grossOf('COST_RETURN');

  return {
    openCount,
    resolvedInPeriod,
    refundDeductionGross: refundDeduction.toFixed(2),
    commissionRefundGross: commissionRefund.toFixed(2),
    costReturnGross: costReturn.toFixed(2),
    netImpactGross: commissionRefund.add(costReturn).sub(refundDeduction).toFixed(2),
  };
}
