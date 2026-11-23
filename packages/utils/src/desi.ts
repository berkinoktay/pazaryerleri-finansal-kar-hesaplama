/**
 * Bounds of a seller-entered desi (ProductVariant.dimensionalWeightOverride),
 * shared by the API validators and the web desi inputs so both read one rule.
 *
 * Owner rule (Berkin 2026-11-23): a desi the seller enters in PazarSync is at
 * least 1. It replaces the 2026-11-22 rule that a seller 0 is a real desi.
 * Clearing the seller desi (null) stays allowed. A Trendyol 0 or missing desi
 * is "no desi" and is stored as null by the marketplace mapper.
 *
 * The upper bound is a UX guard against typos; the Decimal(6,2) column itself
 * holds up to 9999.99. Both are decimal strings: read them with decimal.js.
 */
export const SELLER_DESI_MIN_INCLUSIVE = '1';
export const SELLER_DESI_MAX_INCLUSIVE = '999.99';
