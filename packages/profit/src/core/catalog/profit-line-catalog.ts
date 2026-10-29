import { ProfitLineLevel, type ProfitLineType } from '@pazarsync/db/enums';

/** Where a line sits in the profit statement layout. */
export type ProfitLineGroup =
  | 'REVENUE'
  | 'PRODUCT_COST'
  | 'MARKETPLACE_FEE'
  | 'TAX'
  | 'SELLER_EXPENSE';
/** Whether the line adds to or subtracts from profit. */
export type ProfitLineDirection = 'INCOME' | 'EXPENSE';
/** How the line participates in the Turkish net VAT calculation. */
export type VatKind = 'OUTPUT' | 'INPUT' | 'NONE';
/** The measure used to split a parcel-level line down to its items. */
export type AllocationBasis = 'STANDALONE_AMOUNT' | 'EQUAL' | 'SALE_SHARE';
/** Which item set a parcel-level line is shared across when it is allocated. */
export type AllocationScope = 'ACTIVE_ITEMS' | 'RETURNED_ITEMS';

export interface ProfitLineSpec {
  readonly group: ProfitLineGroup;
  readonly direction: ProfitLineDirection;
  readonly vatKind: VatKind;
  readonly levels: readonly ProfitLineLevel[];
  readonly settlementRequired: boolean;
  readonly allocationBasis: AllocationBasis | null;
  /**
   * Which items share the line when it sits at parcel level: the active items for a
   * forward line, the returned items for a return-leg line. Ignored for item-only
   * types, which are never allocated.
   */
  readonly allocationScope: AllocationScope;
  readonly labelKey: string;
}

// Shared level sets, typed wide (`readonly ProfitLineLevel[]`) on purpose: `as const`
// below would otherwise narrow each inline array to a single-member tuple, which makes
// `Object.values(PROFIT_LINE_CATALOG)[n].levels.includes(...)` reject a valid level.
const LEVELS_ITEM: readonly ProfitLineLevel[] = [ProfitLineLevel.ITEM];
const LEVELS_PARCEL: readonly ProfitLineLevel[] = [ProfitLineLevel.PARCEL];
const LEVELS_PARCEL_ITEM: readonly ProfitLineLevel[] = [
  ProfitLineLevel.PARCEL,
  ProfitLineLevel.ITEM,
];
const LEVELS_ITEM_PARCEL: readonly ProfitLineLevel[] = [
  ProfitLineLevel.ITEM,
  ProfitLineLevel.PARCEL,
];

/**
 * The marketplace-agnostic profit line catalog. Keys follow the `ProfitLineType`
 * enum order; the profit statement renders lines in this order. Adding a new
 * `ProfitLineType` is a compile error here until it gets a spec.
 */
export const PROFIT_LINE_CATALOG = {
  SALE: {
    group: 'REVENUE',
    direction: 'INCOME',
    vatKind: 'OUTPUT',
    levels: LEVELS_ITEM,
    settlementRequired: true,
    allocationBasis: null,
    allocationScope: 'ACTIVE_ITEMS',
    labelKey: 'profit.lines.sale',
  },
  MARKETPLACE_DISCOUNT_CONTRIBUTION: {
    group: 'REVENUE',
    direction: 'INCOME',
    vatKind: 'OUTPUT',
    levels: LEVELS_ITEM,
    settlementRequired: true,
    allocationBasis: null,
    allocationScope: 'ACTIVE_ITEMS',
    labelKey: 'profit.lines.marketplaceDiscountContribution',
  },
  SALE_RETURN: {
    group: 'REVENUE',
    direction: 'EXPENSE',
    vatKind: 'OUTPUT',
    levels: LEVELS_ITEM,
    settlementRequired: true,
    allocationBasis: null,
    allocationScope: 'RETURNED_ITEMS',
    labelKey: 'profit.lines.saleReturn',
  },
  COST_COGS: {
    group: 'PRODUCT_COST',
    direction: 'EXPENSE',
    vatKind: 'INPUT',
    levels: LEVELS_ITEM,
    settlementRequired: false,
    allocationBasis: null,
    allocationScope: 'ACTIVE_ITEMS',
    labelKey: 'profit.lines.costCogs',
  },
  COST_PACKAGING: {
    group: 'PRODUCT_COST',
    direction: 'EXPENSE',
    vatKind: 'INPUT',
    levels: LEVELS_ITEM,
    settlementRequired: false,
    allocationBasis: null,
    allocationScope: 'ACTIVE_ITEMS',
    labelKey: 'profit.lines.costPackaging',
  },
  COST_SHIPPING: {
    group: 'PRODUCT_COST',
    direction: 'EXPENSE',
    vatKind: 'INPUT',
    levels: LEVELS_ITEM,
    settlementRequired: false,
    allocationBasis: null,
    allocationScope: 'ACTIVE_ITEMS',
    labelKey: 'profit.lines.costShipping',
  },
  COST_SOFTWARE: {
    group: 'PRODUCT_COST',
    direction: 'EXPENSE',
    vatKind: 'INPUT',
    levels: LEVELS_ITEM,
    settlementRequired: false,
    allocationBasis: null,
    allocationScope: 'ACTIVE_ITEMS',
    labelKey: 'profit.lines.costSoftware',
  },
  COST_MARKETING: {
    group: 'PRODUCT_COST',
    direction: 'EXPENSE',
    vatKind: 'INPUT',
    levels: LEVELS_ITEM,
    settlementRequired: false,
    allocationBasis: null,
    allocationScope: 'ACTIVE_ITEMS',
    labelKey: 'profit.lines.costMarketing',
  },
  COST_OTHER: {
    group: 'PRODUCT_COST',
    direction: 'EXPENSE',
    vatKind: 'INPUT',
    levels: LEVELS_ITEM,
    settlementRequired: false,
    allocationBasis: null,
    allocationScope: 'ACTIVE_ITEMS',
    labelKey: 'profit.lines.costOther',
  },
  COST_RETURN: {
    group: 'PRODUCT_COST',
    direction: 'INCOME',
    vatKind: 'INPUT',
    levels: LEVELS_ITEM,
    settlementRequired: false,
    allocationBasis: null,
    allocationScope: 'RETURNED_ITEMS',
    labelKey: 'profit.lines.costReturn',
  },
  COMMISSION: {
    group: 'MARKETPLACE_FEE',
    direction: 'EXPENSE',
    vatKind: 'INPUT',
    levels: LEVELS_ITEM,
    settlementRequired: true,
    allocationBasis: null,
    allocationScope: 'ACTIVE_ITEMS',
    labelKey: 'profit.lines.commission',
  },
  COMMISSION_REFUND: {
    group: 'MARKETPLACE_FEE',
    direction: 'INCOME',
    vatKind: 'INPUT',
    levels: LEVELS_ITEM,
    settlementRequired: true,
    allocationBasis: null,
    allocationScope: 'RETURNED_ITEMS',
    labelKey: 'profit.lines.commissionRefund',
  },
  SHIPPING: {
    group: 'MARKETPLACE_FEE',
    direction: 'EXPENSE',
    vatKind: 'INPUT',
    levels: LEVELS_PARCEL,
    settlementRequired: true,
    allocationBasis: 'STANDALONE_AMOUNT',
    allocationScope: 'ACTIVE_ITEMS',
    labelKey: 'profit.lines.shipping',
  },
  RETURN_SHIPPING: {
    group: 'MARKETPLACE_FEE',
    direction: 'EXPENSE',
    vatKind: 'INPUT',
    levels: LEVELS_PARCEL,
    settlementRequired: true,
    allocationBasis: 'STANDALONE_AMOUNT',
    allocationScope: 'RETURNED_ITEMS',
    labelKey: 'profit.lines.returnShipping',
  },
  SERVICE_FEE: {
    group: 'MARKETPLACE_FEE',
    direction: 'EXPENSE',
    vatKind: 'INPUT',
    levels: LEVELS_PARCEL_ITEM,
    settlementRequired: true,
    allocationBasis: 'EQUAL',
    allocationScope: 'ACTIVE_ITEMS',
    labelKey: 'profit.lines.serviceFee',
  },
  PAYMENT_SERVICE_FEE: {
    group: 'MARKETPLACE_FEE',
    direction: 'EXPENSE',
    vatKind: 'INPUT',
    levels: LEVELS_PARCEL_ITEM,
    settlementRequired: true,
    allocationBasis: 'SALE_SHARE',
    allocationScope: 'ACTIVE_ITEMS',
    labelKey: 'profit.lines.paymentServiceFee',
  },
  INTERNATIONAL_SERVICE_FEE: {
    group: 'MARKETPLACE_FEE',
    direction: 'EXPENSE',
    vatKind: 'INPUT',
    levels: LEVELS_PARCEL_ITEM,
    settlementRequired: true,
    allocationBasis: 'SALE_SHARE',
    allocationScope: 'ACTIVE_ITEMS',
    labelKey: 'profit.lines.internationalServiceFee',
  },
  INTERNATIONAL_OPERATION_FEE: {
    group: 'MARKETPLACE_FEE',
    direction: 'EXPENSE',
    vatKind: 'INPUT',
    levels: LEVELS_PARCEL_ITEM,
    settlementRequired: true,
    allocationBasis: 'SALE_SHARE',
    allocationScope: 'RETURNED_ITEMS',
    labelKey: 'profit.lines.internationalOperationFee',
  },
  PENALTY: {
    group: 'MARKETPLACE_FEE',
    direction: 'EXPENSE',
    vatKind: 'INPUT',
    levels: LEVELS_PARCEL_ITEM,
    settlementRequired: false,
    allocationBasis: 'SALE_SHARE',
    allocationScope: 'ACTIVE_ITEMS',
    labelKey: 'profit.lines.penalty',
  },
  ADJUSTMENT_INCOME: {
    group: 'MARKETPLACE_FEE',
    direction: 'INCOME',
    vatKind: 'INPUT',
    levels: LEVELS_PARCEL_ITEM,
    settlementRequired: false,
    allocationBasis: 'SALE_SHARE',
    allocationScope: 'ACTIVE_ITEMS',
    labelKey: 'profit.lines.adjustmentIncome',
  },
  ADJUSTMENT_EXPENSE: {
    group: 'MARKETPLACE_FEE',
    direction: 'EXPENSE',
    vatKind: 'INPUT',
    levels: LEVELS_PARCEL_ITEM,
    settlementRequired: false,
    allocationBasis: 'SALE_SHARE',
    allocationScope: 'ACTIVE_ITEMS',
    labelKey: 'profit.lines.adjustmentExpense',
  },
  STOPPAGE: {
    group: 'TAX',
    direction: 'EXPENSE',
    vatKind: 'NONE',
    levels: LEVELS_ITEM_PARCEL,
    settlementRequired: true,
    allocationBasis: 'SALE_SHARE',
    allocationScope: 'ACTIVE_ITEMS',
    labelKey: 'profit.lines.stoppage',
  },
  STOPPAGE_REFUND: {
    group: 'TAX',
    direction: 'INCOME',
    vatKind: 'NONE',
    levels: LEVELS_ITEM_PARCEL,
    settlementRequired: true,
    allocationBasis: 'SALE_SHARE',
    allocationScope: 'RETURNED_ITEMS',
    labelKey: 'profit.lines.stoppageRefund',
  },
  SELLER_ORDER_EXPENSE: {
    group: 'SELLER_EXPENSE',
    direction: 'EXPENSE',
    vatKind: 'INPUT',
    levels: LEVELS_PARCEL,
    settlementRequired: false,
    allocationBasis: 'EQUAL',
    allocationScope: 'ACTIVE_ITEMS',
    labelKey: 'profit.lines.sellerOrderExpense',
  },
} as const satisfies Record<ProfitLineType, ProfitLineSpec>;

/** Returns the catalog spec for a line type. */
export function getLineSpec(type: ProfitLineType): ProfitLineSpec {
  return PROFIT_LINE_CATALOG[type];
}
