/**
 * Profit engine version. Stamped onto every profit statement so a stored result
 * can be told apart from one produced by a later engine. Bump when a change to the
 * engine would alter the computed numbers for the same inputs.
 *
 * 3: statements of excluded orders no longer carry a net profit or margins.
 * 4: every statement records a reconciliation status derived from its selected lines.
 * 5: tariff period bounds are matched at the real instant on a half-open interval,
 *    so an order near a period boundary can resolve to a different commission band.
 * 6: the order's own carrier (matched from its cargoProviderName) drives the shipping
 *    estimate instead of always the store's default carrier.
 * 7: an order's commission no longer consults product tariff bands; the chain is the
 *    order rate, then the synced product rate, then the category rule.
 * 8: an order whose carrier Trendyol does not name recognizably gets a zero shipping
 *    estimate (recording the reason) instead of the store default or an unavailable gap.
 * 9: an order whose carrier is not recognized records a non-blocking CARRIER_NOT_RECOGNIZED
 *    issue, and a seller-cargo-agreement order on a Trendyol-contract store keeps its
 *    shipping as an estimate with a SELLER_CARGO_AGREEMENT_ESTIMATE issue.
 */
export const PROFIT_ENGINE_VERSION = 9;
