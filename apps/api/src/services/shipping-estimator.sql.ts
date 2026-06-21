/**
 * Raw SQL CTE that computes per-variant shipping estimate inline with the
 * products list. The canonical algorithm lives in `shipping-estimator.service.ts`
 * (see `estimateShippingCostForVariant`); this SQL is a performance mirror to
 * avoid N+1 on a paginated products list (same pattern as cost-profile's
 * `current_cost_try` in `products-list.service.ts`). The equivalence test
 * `apps/api/tests/integration/shipping-estimator-equivalence.test.ts` asserts
 * the two implementations agree across all 6 documented outcome states plus
 * a 7th branch-ordering scenario (OWN_CONTRACT + null desi → NO_DESI).
 *
 * Parameters: $1 = organizationId, $2 = storeId
 *
 * Returned row shape:
 *   { id, estimated_shipping_net, shipping_tariff_applied,
 *     shipping_estimate_status, shipping_carrier_code }
 *
 * The CTE returns one row per variant in the (organization, store) scope.
 * Callers join the result against the page of variants they have already
 * loaded; rows for variants outside the current page are simply ignored.
 * The store filter mirrors the sister `fetchCostAggregates` constraint —
 * the products list endpoint is always store-scoped, so constraining at
 * the CTE level avoids scanning every variant in the org. The query plan
 * is dominated by the `(organization_id, store_id)` filter (indexed) plus
 * three LATERAL lookups against shipping_*_tariffs tables (all indexed by
 * (carrier_id, desi) / (carrier_id, min_order_amount, max_order_amount)).
 *
 * CASE branch ordering for `shipping_estimate_status` mirrors the service:
 *   1. NO_CARRIER  (TRENDYOL_CONTRACT + null carrier) — service line 124
 *      takes precedence over the NO_DESI check on line 127.
 *   2. NO_DESI     (no override and no synced desi) — service line 102/127.
 *   3. OWN_CONTRACT_EMPTY (OWN_CONTRACT + no own_shipping_tariffs row).
 *   4. OK          (any tariff resolved).
 *   5. DESI_OVERFLOW (fall-through).
 * The OWN_CONTRACT branch in the service evaluates NO_DESI BEFORE
 * OWN_CONTRACT_EMPTY; the order above honours that on the OWN_CONTRACT
 * source by checking NO_DESI before OWN_CONTRACT_EMPTY.
 */
export const SHIPPING_ESTIMATE_CTE_SQL = `
WITH variant_with_carrier AS (
  SELECT pv.id, pv.store_id, pv.sale_price, pv.delivery_duration, pv.is_rush_delivery,
         pv.fast_delivery_options, pv.dimensional_weight, pv.synced_dimensional_weight,
         s.shipping_tariff_source, s.default_shipping_carrier_id,
         sc.code AS carrier_code, sc.supports_barem_destek, sc.max_barem_desi,
         sc.max_barem_eligible_delivery_duration,
         COALESCE(pv.dimensional_weight, pv.synced_dimensional_weight) AS eff_desi
  FROM product_variants pv
  JOIN stores s ON s.id = pv.store_id
  LEFT JOIN shipping_carriers sc ON sc.id = s.default_shipping_carrier_id
  WHERE pv.organization_id = $1::uuid
    AND pv.store_id = $2::uuid
),
estimates AS (
  SELECT
    vwc.id,
    -- Cast to text so Prisma's $queryRawUnsafe returns a string, matching
    -- the wire shape the validator expects (Decimal-as-string, consistent
    -- with every other monetary field on the response). Without ::text
    -- Prisma surfaces a Decimal object that the equivalence test must
    -- coerce by hand.
    (
      CASE
        WHEN vwc.shipping_tariff_source = 'OWN_CONTRACT' THEN own_tariff.price_net
        WHEN barem.price_net IS NOT NULL THEN barem.price_net
        ELSE desi_tariff.price_net
      END
    )::text AS estimated_shipping_net,
    CASE
      WHEN vwc.shipping_tariff_source = 'OWN_CONTRACT' AND own_tariff.price_net IS NOT NULL THEN 'OWN_CONTRACT'
      WHEN barem.price_net IS NOT NULL THEN 'BAREM'
      WHEN desi_tariff.price_net IS NOT NULL THEN 'NORMAL'
      ELSE NULL
    END AS shipping_tariff_applied,
    CASE
      WHEN vwc.shipping_tariff_source = 'TRENDYOL_CONTRACT'
           AND vwc.default_shipping_carrier_id IS NULL THEN 'NO_CARRIER'
      WHEN vwc.eff_desi IS NULL THEN 'NO_DESI'
      WHEN vwc.shipping_tariff_source = 'OWN_CONTRACT'
           AND own_tariff.price_net IS NULL THEN 'OWN_CONTRACT_EMPTY'
      WHEN barem.price_net IS NOT NULL OR desi_tariff.price_net IS NOT NULL THEN 'OK'
      ELSE 'DESI_OVERFLOW'
    END AS shipping_estimate_status,
    vwc.carrier_code AS shipping_carrier_code,
    -- Effective desi (override ?? synced), text-cast like estimated_shipping_net.
    -- Consumed by batchResolveShipping to populate ShippingEstimate.baseDesiAtEstimate;
    -- products-list ignores this column.
    vwc.eff_desi::text AS eff_desi
  FROM variant_with_carrier vwc
  LEFT JOIN LATERAL (
    SELECT price_net FROM own_shipping_tariffs
     WHERE store_id = vwc.store_id AND desi = CEIL(vwc.eff_desi)::int
     LIMIT 1
  ) own_tariff ON vwc.shipping_tariff_source = 'OWN_CONTRACT'
  LEFT JOIN LATERAL (
    SELECT sbt.price_net FROM shipping_barem_tariffs sbt
     WHERE sbt.carrier_id = vwc.default_shipping_carrier_id
       AND vwc.supports_barem_destek = true
       AND vwc.eff_desi <= vwc.max_barem_desi
       AND (
         (vwc.delivery_duration IS NOT NULL AND vwc.delivery_duration <= vwc.max_barem_eligible_delivery_duration)
         OR vwc.is_rush_delivery = true
         OR jsonb_array_length(vwc.fast_delivery_options) > 0
       )
       AND vwc.sale_price >= sbt.min_order_amount
       AND vwc.sale_price <= sbt.max_order_amount
     LIMIT 1
  ) barem ON vwc.shipping_tariff_source = 'TRENDYOL_CONTRACT'
  LEFT JOIN LATERAL (
    SELECT price_net FROM shipping_desi_tariffs
     WHERE carrier_id = vwc.default_shipping_carrier_id AND desi = CEIL(vwc.eff_desi)::int
     LIMIT 1
  ) desi_tariff ON vwc.shipping_tariff_source = 'TRENDYOL_CONTRACT'
)
SELECT id, estimated_shipping_net, shipping_tariff_applied, shipping_estimate_status, shipping_carrier_code, eff_desi
FROM estimates;
` as const;

/**
 * Wire shape of one row from `SHIPPING_ESTIMATE_CTE_SQL`. Exported alongside
 * the SQL so callers (the products list service + the equivalence test)
 * share a single source of truth for the column types.
 */
export interface ShippingEstimateRow {
  id: string;
  estimated_shipping_net: string | null;
  shipping_tariff_applied: 'NORMAL' | 'BAREM' | 'OWN_CONTRACT' | null;
  shipping_estimate_status:
    | 'OK'
    | 'NO_CARRIER'
    | 'NO_DESI'
    | 'OWN_CONTRACT_EMPTY'
    | 'DESI_OVERFLOW';
  shipping_carrier_code: string | null;
  /** Effective desi (override ?? synced), text-cast. Null only if both are null. */
  eff_desi: string | null;
}
