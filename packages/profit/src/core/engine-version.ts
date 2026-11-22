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
 * 10: a stored order reads the product and seller inputs captured when it was first
 *     computed (order profit snapshot) instead of their live values.
 * 11: Barem picks table 1 or table 2 by the order's fast-delivery promise and whether it
 *     shipped by Trendyol's agreed ship-by date (two-tier versions only); a return of an
 *     order that went out at table 1 is priced at table 1 when the version says so.
 * 12: a not-recognized carrier on a Trendyol-agreement order blocks the profit (no zero
 *     shipping line; a seller-cargo-agreement order is exempt); a carrier with no tariff
 *     version in force reports NO_TARIFF_VERSION; a missing fee definition or micro-export
 *     return tier records REFERENCE_DATA_MISSING and leaves that fee out instead of
 *     throwing, so every order gets a statement; that issue holds reconciliation like a
 *     settlement gap, and an export return fee is not written while the commission VAT is
 *     unknown. Each statement view keeps its own issues: in the best-known view a cargo
 *     invoice lifts the carrier and shipping-estimate causes of the leg it bills.
 */
export const PROFIT_ENGINE_VERSION = 12;
