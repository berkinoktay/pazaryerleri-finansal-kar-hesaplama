import { CostProfileType, ProfitLineType } from '@pazarsync/db/enums';

/**
 * Maps a seller cost-profile category to the profit line type its amount becomes.
 * Every `CostProfileType` resolves to a `PRODUCT_COST` expense line (the compiler
 * guards completeness through `satisfies Record<CostProfileType, ProfitLineType>`).
 */
export const COST_PROFILE_LINE_TYPE = {
  [CostProfileType.COGS]: ProfitLineType.COST_COGS,
  [CostProfileType.PACKAGING]: ProfitLineType.COST_PACKAGING,
  [CostProfileType.SHIPPING]: ProfitLineType.COST_SHIPPING,
  [CostProfileType.SOFTWARE]: ProfitLineType.COST_SOFTWARE,
  [CostProfileType.MARKETING]: ProfitLineType.COST_MARKETING,
  [CostProfileType.OTHER]: ProfitLineType.COST_OTHER,
} as const satisfies Record<CostProfileType, ProfitLineType>;
