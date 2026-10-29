export { applyEstimateOnOrderCreate } from './estimate-on-order-create';
export { estimateReturnOnClaim } from './estimate-return-on-claim';
export { computeProfit } from './profit-formula';
export type {
  ProfitBreakdown,
  ProfitInput,
  ProfitInputFee,
  ProfitMoneyPair,
} from './profit-formula';
export { inferShippedSameDay, type OrderForShipTiming } from './infer-shipped-same-day';
export {
  recomputeSettledProfit,
  type RecomputeSettledProfitResult,
} from './recompute-settled-profit';
export {
  FeeDefinitionNotFoundError,
  isMicroExport,
  isPsfExempt,
  resolveFeeDefinition,
} from './resolve-fee-definition';
export {
  resolveOrderCalculability,
  type CalcResult,
  type OrderLineForCalcCheck,
} from './resolve-order-calculability';
export { buildCalcCheckLines } from './build-calc-check-lines';
export { computeNetSaleGross } from './fold-return-legs';
export {
  overseasReturnOperationGross,
  resolveOverseasReturnRate,
  MicroExportReturnTierNotFoundError,
  type OverseasReturnLeg,
} from './overseas-return-operation';
export {
  buildProfitBreakdown,
  type BuildProfitBreakdownInput,
  type ProfitBreakdownFeeInput,
  type ProfitBreakdownItemInput,
  type ProfitBreakdownView,
} from './build-profit-breakdown';
export {
  resolveTariffForDesi,
  type EstimateOutcome,
  type EstimateUnavailableReason,
  type ResolveTariffInput,
  type ShippingEstimate,
} from './shipping/resolve-tariff';
export { estimateShippingCostForOrder } from './shipping/estimate-order-shipping';
export { grossToVat } from './money';
export { resolveCommissionRate, type ResolvedCommissionRate } from './resolve-commission-rate';
export {
  buildUnitProfitInput,
  computeUnitProfit,
  solvePriceForTarget,
  type UnitEconomics,
  type PriceTarget,
  type SolveReason,
  type SolveResult,
} from './unit-pricing';

// Profit line core (rebuild, phase 1) -- docs/plans/2026-10-29-profit-engine-design.md
export { roundMoney } from './money';
export {
  CURRENCY_TRY,
  InvalidCurrencyCodeError,
  isCurrencyCode,
  toCurrencyCode,
  type CurrencyCode,
} from './core/fx/currency-code';
export {
  createProfitLine,
  nativeFx,
  InvalidProfitLineError,
  type ExternalRecordRef,
  type FxConversion,
  type LineMoney,
  type ProfitLine,
  type ProfitLineInputs,
  type ProfitLineInputValue,
} from './core/profit-line';
export {
  getLineSpec,
  PROFIT_LINE_CATALOG,
  type AllocationBasis,
  type ProfitLineDirection,
  type ProfitLineGroup,
  type ProfitLineSpec,
  type VatKind,
} from './core/catalog/profit-line-catalog';
export { COST_PROFILE_LINE_TYPE } from './core/catalog/cost-profile-line-type';
export { vatFromGross } from './tax/tr/vat';
export { netSaleStoppageBase, stoppageAmount } from './tax/tr/stoppage';
export { computeVatTotals, effectiveNetVat, type VatTotals } from './tax/tr/net-vat';
export { selectLines, type LineSelectionMode } from './core/select-lines';
export { InvalidAllocationError, splitByWeights } from './core/allocation/split-by-weights';
export {
  resolveAllocationWeights,
  type AllocationItem,
  type ResolvedAllocationWeights,
} from './core/allocation/allocation-weights';
export {
  allocateParcelLine,
  type ProfitLineAllocation,
} from './core/allocation/allocate-parcel-line';
export {
  FX_RATE_DECIMALS,
  selectFxRate,
  type FxRateQuote,
  type SelectedFxRate,
} from './core/fx/select-fx-rate';
export { convertLineMoney } from './core/fx/convert-line-money';
export { isBlockingIssue, PROFIT_ISSUE_CATALOG, type ProfitIssue } from './core/profit-issue';
export { deriveProfitStatus, type DeriveProfitStatusParams } from './core/profit-status';
export { PROFIT_ENGINE_VERSION } from './core/engine-version';
export {
  computeProfitStatement,
  type ProfitStatement,
  type ProfitStatementInput,
  type ProfitStatementRow,
  type ProfitStatementView,
} from './core/profit-statement';
