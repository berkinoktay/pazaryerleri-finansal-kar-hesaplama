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
export {
  ProfitLineLevelConflictError,
  selectLines,
  type LineSelectionMode,
} from './core/select-lines';
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

// Trendyol module and seller costs (rebuild, phase 2A) -- docs/plans/2026-10-29-profit-engine-faz-2a-plan.md
export {
  activeItems,
  assertAcceptedReturns,
  assertParcelSnapshot,
  InvalidParcelSnapshotError,
  type AcceptedReturn,
  type ParcelItemSnapshot,
  type ParcelSnapshot,
} from './core/parcel-snapshot';
export {
  buildSellerCostLines,
  type CostProfileVersionInput,
  type ItemCostInput,
  type ItemCostProfileInput,
} from './core/seller-costs/build-seller-cost-lines';
export { buildCostReturnLines } from './core/seller-costs/build-cost-return-lines';
export {
  itemsForAllocation,
  type AllocationItemSets,
} from './core/allocation/allocation-item-sets';
export { type AllocationScope } from './core/catalog/profit-line-catalog';
export { KURUS_DECIMALS, kurusAmountViolation } from './money';
export { saleVatRatePct } from './tax/tr/sale-vat';
export { buildStoppageLines, buildStoppageRefundLines } from './tax/tr/stoppage-lines';
export { grossFromNet } from './tax/tr/vat';
export {
  TRENDYOL_CURRENCY,
  TRENDYOL_SAME_DAY_SHIPPING_TYPE,
  trendyolCategoryBrandKey,
  type OverseasReturnTier,
  type TrendyolBaremBand,
  type TrendyolCommissionBand,
  type TrendyolCommissionRules,
  type TrendyolFeeParams,
  type TrendyolItemAttributes,
  type TrendyolParcelAttributes,
  type TrendyolReferenceData,
  type TrendyolShippingCarrier,
  type TrendyolShippingTariff,
} from './marketplaces/trendyol/trendyol-inputs';
export {
  resolveTrendyolCommissionRate,
  trendyolBandForPrice,
  type ResolvedTrendyolCommissionRate,
  type TrendyolCommissionRateSource,
} from './marketplaces/trendyol/resolve-commission-rate';
export {
  estimateCommissionLines,
  estimateSaleLines,
} from './marketplaces/trendyol/estimate-sale-and-commission';
export { estimateServiceFeeLine } from './marketplaces/trendyol/estimate-service-fee';
export {
  estimateShippingLine,
  parcelDesi,
  resolveTrendyolShippingGross,
  resolveTrendyolShippingNet,
  trendyolCarrierCodeForKind,
  type ShippingTariffKind,
  type ShippingUnavailableReason,
} from './marketplaces/trendyol/estimate-shipping';
export { estimateInternationalServiceLine } from './marketplaces/trendyol/estimate-export-fees';
export { estimateReturnLines } from './marketplaces/trendyol/estimate-returns';
export {
  estimateTrendyolParcel,
  type EstimateResult,
  type TrendyolEstimateInput,
} from './marketplaces/trendyol/estimate-parcel';
export {
  isTrendyolTransactionType,
  recordKind,
  TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
  TRENDYOL_CARGO_RETURN_ITEM_TYPE,
  TRENDYOL_OTHER_FINANCIAL_RECORD_KIND,
  TRENDYOL_RECORD_KIND,
  TRENDYOL_RETURN_CYCLE_CONFIRMED_TYPES,
  TRENDYOL_SALE_CYCLE_CONFIRMED_TYPES,
  TRENDYOL_SETTLEMENT_RECORD_KIND,
  type TrendyolCargoInvoiceItem,
  type TrendyolRecordKind,
  type TrendyolSettlementRecord,
  type TrendyolTransactionType,
} from './marketplaces/trendyol/settlement-records';
export {
  trendyolCargoInvoiceItemInputs,
  trendyolOtherFinancialRecordInput,
  trendyolSettlementRecordInput,
} from './marketplaces/trendyol/finance-record-inputs';
export {
  parseStoredTariffBands,
  type StoredTariffBand,
} from './marketplaces/trendyol/stored-tariff-bands';
export {
  mapTrendyolRecords,
  type MappingResult,
  type TrendyolMappingInput,
} from './marketplaces/trendyol/map-records';

// Scenario and price solver (rebuild, phase 2B) -- docs/plans/2026-10-29-profit-engine-faz-2b-plan.md
export { ceilToKurus, floorToKurus } from './money';
export {
  solveScenarioPrice,
  SCENARIO_SAMPLE_SPAN,
  SCENARIO_LINE_ROUNDING_BOUND,
  SCENARIO_MAX_SCAN_STEPS,
  type ScenarioPriceTarget,
  type ScenarioSolveFailure,
  type ScenarioSolveResult,
} from './core/scenario/solve-scenario-price';
export {
  buildTrendyolScenarioParcel,
  evaluateTrendyolScenario,
  trendyolScenarioBreakpoints,
  solveTrendyolScenarioPrice,
  TRENDYOL_SCENARIO_PARCEL_ID,
  TRENDYOL_SCENARIO_ITEM_ID,
  type TrendyolScenarioProduct,
  type TrendyolScenarioInput,
  type TrendyolScenarioBase,
  type TrendyolScenarioResult,
} from './marketplaces/trendyol/scenario';

// Persistence (rebuild, phase 3A) -- docs/plans/2026-10-30-profit-engine-faz-3a-plan.md
export {
  recomputeParcelProfit,
  acquireParcelProfitLock,
  type RecomputeParcelResult,
} from './persistence/recompute-parcel-profit';
export { loadTrendyolParcel, type LoadedTrendyolParcel } from './persistence/load-trendyol-parcel';
export { ParcelNotFoundError, UnsupportedPlatformError } from './persistence/errors';
export { type FinanceRecordInput } from './core/finance-record-input';
export { ingestFinanceRecords } from './persistence/finance-records';

// Profit recompute queue (rebuild, phase 3B) -- docs/plans/2026-10-30-profit-engine-faz-3b-plan.md
export {
  enqueueProfitRecompute,
  enqueueProfitRecomputeForVariants,
  enqueueProfitRecomputeForStore,
  enqueueStaleProfitStatements,
  claimProfitRecomputeRequests,
  processClaimedRecompute,
  drainProfitRecomputeQueue,
  type EnqueueScope,
  type ClaimedRecompute,
  type RecomputeOutcome,
  type DrainResult,
} from './persistence/recompute-queue';
