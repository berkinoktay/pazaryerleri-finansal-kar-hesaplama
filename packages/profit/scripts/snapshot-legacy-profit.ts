// Read-only, one-off legacy profit snapshot.
//
// Purpose: capture today's legacy profit numbers from the DEV database into a
// JSON file BEFORE the phase 3A migrations run, so the rebuilt profit engine's
// numbers can be diffed against the old ones later. The phase-3A migrations and
// the RLS test suite can mutate this data, so the snapshot must be taken first;
// it cannot be reproduced afterwards.
//
// Strictly read-only against the database: it issues a single `findMany` and a
// `$disconnect`, and never writes to the database. The only file it writes is
// the local output JSON below.
//
// Run from inside the package (connects with DATABASE_URL from the workspace-root .env):
//   cd packages/profit && pnpm exec tsx --env-file=../../.env scripts/snapshot-legacy-profit.ts
// The `pnpm --filter @pazarsync/profit exec` form does not find the .env file.
//
// Output (docs/ is git-ignored; do not commit this file):
//   docs/plans/data/2026-10-30-legacy-profit-snapshot.json

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Prisma, prisma } from '@pazarsync/db';

const MONEY_DP = 2;
const PERCENT_DP = 4;

const scriptDir = dirname(fileURLToPath(import.meta.url));
// scripts -> profit -> packages -> repo root
const repoRoot = resolve(scriptDir, '../../..');
const OUTPUT_PATH = join(
  repoRoot,
  'docs',
  'plans',
  'data',
  '2026-10-30-legacy-profit-snapshot.json',
);

// Prisma returns money/rate columns as decimal.js instances; render them as
// fixed-precision strings so the snapshot never loses precision to a float.
function moneyString(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(MONEY_DP);
}

function percentString(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(PERCENT_DP);
}

function sortRecord(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

// Fields are selected explicitly (never a whole-row spread) so no customer name,
// address, phone, e-mail or cargo-address field can leak into the snapshot.
const orderSelect = {
  id: true,
  storeId: true,
  organizationId: true,
  platformOrderId: true,
  platformOrderNumber: true,
  orderDate: true,
  status: true,
  micro: true,
  reconciliationStatus: true,
  profitExcludedAt: true,
  saleGross: true,
  saleVat: true,
  listGross: true,
  sellerDiscountGross: true,
  sellerDiscountVat: true,
  estimatedNetProfit: true,
  settledNetProfit: true,
  estimatedNetVat: true,
  settledNetVat: true,
  estimatedSaleMarginPct: true,
  settledSaleMarginPct: true,
  estimatedCostMarkupPct: true,
  settledCostMarkupPct: true,
  snapshotIncludeStopaj: true,
  snapshotIncludeNegativeNetVat: true,
  cargoDeci: true,
  usesSellerCargoAgreement: true,
  fastDelivery: true,
  fastDeliveryType: true,
  items: {
    orderBy: { id: 'asc' },
    select: {
      id: true,
      productVariantId: true,
      barcode: true,
      quantity: true,
      lineListGross: true,
      lineSaleGross: true,
      lineSellerDiscountGross: true,
      saleVatRate: true,
      commissionRate: true,
      commissionGross: true,
      refundedCommissionGross: true,
      commissionVatRate: true,
      estimatedCommissionGross: true,
      settledCommissionGross: true,
      settledSaleAmount: true,
      unitCostSnapshotGross: true,
      unitCostSnapshotVatRate: true,
    },
  },
  fees: {
    orderBy: { id: 'asc' },
    select: {
      feeType: true,
      source: true,
      direction: true,
      amountGross: true,
      vatRate: true,
      confirmedAt: true,
      orderClaimItemId: true,
    },
  },
} satisfies Prisma.OrderSelect;

type OrderRow = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;
type OrderItemRow = OrderRow['items'][number];
type OrderFeeRow = OrderRow['fees'][number];

interface SnapshotFee {
  readonly feeType: string;
  readonly source: string;
  readonly direction: string;
  readonly amountGross: string | null;
  readonly vatRate: string | null;
  readonly confirmed: boolean;
  readonly orderClaimItemId: string | null;
}

interface SnapshotItem {
  readonly id: string;
  readonly productVariantId: string | null;
  readonly barcode: string | null;
  readonly quantity: number;
  readonly lineListGross: string | null;
  readonly lineSaleGross: string | null;
  readonly lineSellerDiscountGross: string | null;
  readonly saleVatRate: string | null;
  readonly commissionRate: string | null;
  readonly commissionGross: string | null;
  readonly refundedCommissionGross: string | null;
  readonly commissionVatRate: string | null;
  readonly estimatedCommissionGross: string | null;
  readonly settledCommissionGross: string | null;
  readonly settledSaleAmount: string | null;
  readonly unitCostSnapshotGross: string | null;
  readonly unitCostSnapshotVatRate: string | null;
}

interface SnapshotOrder {
  readonly id: string;
  readonly storeId: string;
  readonly organizationId: string;
  readonly platformOrderId: string;
  readonly platformOrderNumber: string | null;
  readonly orderDate: string;
  readonly status: string;
  readonly micro: boolean;
  readonly reconciliationStatus: string;
  readonly isExcluded: boolean;
  readonly saleGross: string | null;
  readonly saleVat: string | null;
  readonly listGross: string | null;
  readonly sellerDiscountGross: string | null;
  readonly sellerDiscountVat: string | null;
  readonly estimatedNetProfit: string | null;
  readonly settledNetProfit: string | null;
  readonly estimatedNetVat: string | null;
  readonly settledNetVat: string | null;
  readonly estimatedSaleMarginPct: string | null;
  readonly settledSaleMarginPct: string | null;
  readonly estimatedCostMarkupPct: string | null;
  readonly settledCostMarkupPct: string | null;
  readonly snapshotIncludeStopaj: boolean | null;
  readonly snapshotIncludeNegativeNetVat: boolean | null;
  readonly cargoDeci: string | null;
  readonly usesSellerCargoAgreement: boolean;
  readonly fastDelivery: boolean;
  readonly fastDeliveryType: string | null;
  readonly items: readonly SnapshotItem[];
  readonly fees: readonly SnapshotFee[];
}

interface SnapshotSummary {
  readonly takenAt: string;
  readonly orderCount: number;
  readonly itemCount: number;
  readonly feeCount: number;
  readonly estimatedNetProfitSum: string;
  readonly settledNetProfitSum: string;
  readonly ordersByReconciliationStatus: Record<string, number>;
  readonly ordersByStatus: Record<string, number>;
}

interface LegacyProfitSnapshot {
  readonly summary: SnapshotSummary;
  readonly orders: readonly SnapshotOrder[];
}

function mapFee(fee: OrderFeeRow): SnapshotFee {
  return {
    feeType: fee.feeType,
    source: fee.source,
    direction: fee.direction,
    amountGross: moneyString(fee.amountGross),
    vatRate: moneyString(fee.vatRate),
    confirmed: fee.confirmedAt !== null,
    orderClaimItemId: fee.orderClaimItemId,
  };
}

function mapItem(item: OrderItemRow): SnapshotItem {
  return {
    id: item.id,
    productVariantId: item.productVariantId,
    barcode: item.barcode,
    quantity: item.quantity,
    lineListGross: moneyString(item.lineListGross),
    lineSaleGross: moneyString(item.lineSaleGross),
    lineSellerDiscountGross: moneyString(item.lineSellerDiscountGross),
    saleVatRate: moneyString(item.saleVatRate),
    commissionRate: moneyString(item.commissionRate),
    commissionGross: moneyString(item.commissionGross),
    refundedCommissionGross: moneyString(item.refundedCommissionGross),
    commissionVatRate: moneyString(item.commissionVatRate),
    estimatedCommissionGross: moneyString(item.estimatedCommissionGross),
    settledCommissionGross: moneyString(item.settledCommissionGross),
    settledSaleAmount: moneyString(item.settledSaleAmount),
    unitCostSnapshotGross: moneyString(item.unitCostSnapshotGross),
    unitCostSnapshotVatRate: moneyString(item.unitCostSnapshotVatRate),
  };
}

function mapOrder(order: OrderRow): SnapshotOrder {
  return {
    id: order.id,
    storeId: order.storeId,
    organizationId: order.organizationId,
    platformOrderId: order.platformOrderId,
    platformOrderNumber: order.platformOrderNumber,
    orderDate: order.orderDate.toISOString(),
    status: order.status,
    micro: order.micro,
    reconciliationStatus: order.reconciliationStatus,
    isExcluded: order.profitExcludedAt !== null,
    saleGross: moneyString(order.saleGross),
    saleVat: moneyString(order.saleVat),
    listGross: moneyString(order.listGross),
    sellerDiscountGross: moneyString(order.sellerDiscountGross),
    sellerDiscountVat: moneyString(order.sellerDiscountVat),
    estimatedNetProfit: moneyString(order.estimatedNetProfit),
    settledNetProfit: moneyString(order.settledNetProfit),
    estimatedNetVat: moneyString(order.estimatedNetVat),
    settledNetVat: moneyString(order.settledNetVat),
    estimatedSaleMarginPct: percentString(order.estimatedSaleMarginPct),
    settledSaleMarginPct: percentString(order.settledSaleMarginPct),
    estimatedCostMarkupPct: percentString(order.estimatedCostMarkupPct),
    settledCostMarkupPct: percentString(order.settledCostMarkupPct),
    snapshotIncludeStopaj: order.snapshotIncludeStopaj,
    snapshotIncludeNegativeNetVat: order.snapshotIncludeNegativeNetVat,
    cargoDeci: moneyString(order.cargoDeci),
    usesSellerCargoAgreement: order.usesSellerCargoAgreement,
    fastDelivery: order.fastDelivery,
    fastDeliveryType: order.fastDeliveryType,
    items: order.items.map(mapItem),
    fees: order.fees.map(mapFee),
  };
}

async function main(): Promise<void> {
  const orders = await prisma.order.findMany({
    orderBy: [{ orderDate: 'asc' }, { id: 'asc' }],
    select: orderSelect,
  });

  const ordersByReconciliationStatus: Record<string, number> = {};
  const ordersByStatus: Record<string, number> = {};
  let estimatedNetProfitSum = new Prisma.Decimal(0);
  let settledNetProfitSum = new Prisma.Decimal(0);
  let itemCount = 0;
  let feeCount = 0;
  const snapshotOrders: SnapshotOrder[] = [];

  for (const order of orders) {
    ordersByReconciliationStatus[order.reconciliationStatus] =
      (ordersByReconciliationStatus[order.reconciliationStatus] ?? 0) + 1;
    ordersByStatus[order.status] = (ordersByStatus[order.status] ?? 0) + 1;
    if (order.estimatedNetProfit !== null) {
      estimatedNetProfitSum = estimatedNetProfitSum.plus(order.estimatedNetProfit);
    }
    if (order.settledNetProfit !== null) {
      settledNetProfitSum = settledNetProfitSum.plus(order.settledNetProfit);
    }
    itemCount += order.items.length;
    feeCount += order.fees.length;
    snapshotOrders.push(mapOrder(order));
  }

  const snapshot: LegacyProfitSnapshot = {
    summary: {
      takenAt: new Date().toISOString(),
      orderCount: snapshotOrders.length,
      itemCount,
      feeCount,
      estimatedNetProfitSum: estimatedNetProfitSum.toFixed(MONEY_DP),
      settledNetProfitSum: settledNetProfitSum.toFixed(MONEY_DP),
      ordersByReconciliationStatus: sortRecord(ordersByReconciliationStatus),
      ordersByStatus: sortRecord(ordersByStatus),
    },
    orders: snapshotOrders,
  };

  // mkdirSync + writeFileSync touch only the local output file, never the DB.
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  console.log(
    `Snapshot written: ${snapshotOrders.length.toString()} orders, ${itemCount.toString()} items, ${feeCount.toString()} fees`,
  );
  console.log(`Output: ${OUTPUT_PATH}`);

  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
