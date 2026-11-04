import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import { prisma } from '@pazarsync/db';
import {
  FinanceRecordFamily,
  ProfitLineCertainty,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';

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

// One row of summed return money, as Postgres numerics. Treated as unknown and
// coerced through Decimal because the raw driver's numeric shape is not fixed.
interface ClaimsMoneyRow {
  refund_deduction_gross: unknown;
  commission_refund_gross: unknown;
  cost_return_gross: unknown;
}

function grossToDecimal(value: unknown): Decimal {
  if (value === null || value === undefined) return new Decimal(0);
  return new Decimal(value.toString());
}

export async function getClaimsSummary(
  orgId: string,
  storeId: string,
  range: ClaimsSummaryQuery,
): Promise<ClaimsSummaryResult> {
  await ensureStoreInOrg(orgId, storeId);

  // Count KPIs run on claimDate (when the claim was opened). Money KPIs run on
  // the settlement record's transaction_date (when the deduction/refund hit the
  // books), NOT on when the profit line was written: a line is dated by joining
  // it to its marketplace_finance_record (same store, SETTLEMENT family,
  // record_id = external_record_id) and reading that record's transaction_date.
  // Refund/commission come from ACTUAL marketplace-record lines in the period; a
  // COST_RETURN counts only when its own order item also carries such a dated
  // SALE_RETURN line.
  const to = range.to ?? new Date();
  const from =
    range.from ?? new Date(to.getTime() - SUMMARY_DEFAULT_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  const [openCount, resolvedInPeriod, moneyRows] = await Promise.all([
    prisma.orderClaim.count({
      where: { organizationId: orgId, storeId, resolved: false },
    }),
    prisma.orderClaim.count({
      where: { organizationId: orgId, storeId, resolved: true, claimDate: { gte: from, lte: to } },
    }),
    prisma.$queryRaw<ClaimsMoneyRow[]>`
      WITH dated_returns AS (
        SELECT pl.type AS line_type, pl.order_item_id, pl.amount_gross
        FROM profit_lines pl
        JOIN marketplace_finance_records r
          ON r.store_id = pl.store_id
         AND r.family = ${FinanceRecordFamily.SETTLEMENT}::"FinanceRecordFamily"
         AND r.record_id = pl.external_record_id
        WHERE pl.organization_id = ${orgId}::uuid
          AND pl.store_id = ${storeId}::uuid
          AND pl.certainty = ${ProfitLineCertainty.ACTUAL}::"ProfitLineCertainty"
          AND pl.source = ${ProfitLineSource.MARKETPLACE_RECORD}::"ProfitLineSource"
          AND pl.type IN (
            ${ProfitLineType.SALE_RETURN}::"ProfitLineType",
            ${ProfitLineType.COMMISSION_REFUND}::"ProfitLineType"
          )
          AND r.organization_id = ${orgId}::uuid
          AND r.store_id = ${storeId}::uuid
          AND r.transaction_date >= ${from}::timestamp(3)
          AND r.transaction_date <= ${to}::timestamp(3)
      ),
      cost_return AS (
        SELECT COALESCE(SUM(pl.amount_gross), 0) AS total
        FROM profit_lines pl
        WHERE pl.organization_id = ${orgId}::uuid
          AND pl.store_id = ${storeId}::uuid
          AND pl.type = ${ProfitLineType.COST_RETURN}::"ProfitLineType"
          AND pl.order_item_id IN (
            SELECT dr.order_item_id
            FROM dated_returns dr
            WHERE dr.line_type = ${ProfitLineType.SALE_RETURN}::"ProfitLineType"
              AND dr.order_item_id IS NOT NULL
          )
      )
      SELECT
        COALESCE(
          SUM(dr.amount_gross) FILTER (WHERE dr.line_type = ${ProfitLineType.SALE_RETURN}::"ProfitLineType"),
          0
        ) AS refund_deduction_gross,
        COALESCE(
          SUM(dr.amount_gross) FILTER (WHERE dr.line_type = ${ProfitLineType.COMMISSION_REFUND}::"ProfitLineType"),
          0
        ) AS commission_refund_gross,
        (SELECT total FROM cost_return) AS cost_return_gross
      FROM dated_returns dr
    `,
  ]);

  const money = moneyRows[0];
  const refundDeduction = grossToDecimal(money?.refund_deduction_gross);
  const commissionRefund = grossToDecimal(money?.commission_refund_gross);
  const costReturn = grossToDecimal(money?.cost_return_gross);

  return {
    openCount,
    resolvedInPeriod,
    refundDeductionGross: refundDeduction.toFixed(2),
    commissionRefundGross: commissionRefund.toFixed(2),
    costReturnGross: costReturn.toFixed(2),
    netImpactGross: commissionRefund.add(costReturn).sub(refundDeduction).toFixed(2),
  };
}
