import type { components } from '@pazarsync/api-client';

/** One reason the order's profit is not computable, as the API reports it. */
export type ProfitBlocker = components['schemas']['ProfitBlocker'];

// SHIPPING_ESTIMATE_UNAVAILABLE details that carry their own sentence. Any other
// detail (and a missing one) reads the generic shipping sentence.
const SHIPPING_DETAIL_KEYS = {
  NO_TARIFF_VERSION: 'reasons.SHIPPING_ESTIMATE_UNAVAILABLE.NO_TARIFF_VERSION',
  DESI_OVERFLOW: 'reasons.SHIPPING_ESTIMATE_UNAVAILABLE.DESI_OVERFLOW',
  UNKNOWN_DESI: 'reasons.SHIPPING_ESTIMATE_UNAVAILABLE.UNKNOWN_DESI',
  NO_CARRIER: 'reasons.SHIPPING_ESTIMATE_UNAVAILABLE.NO_CARRIER',
  OWN_CONTRACT_EMPTY: 'reasons.SHIPPING_ESTIMATE_UNAVAILABLE.OWN_CONTRACT_EMPTY',
} as const;

type ShippingDetail = keyof typeof SHIPPING_DETAIL_KEYS;

/** The engine prefixes a return-leg shipping detail with this (`RETURN_UNKNOWN_DESI`, ...). */
const RETURN_DETAIL_PREFIX = 'RETURN_';

/** The REFERENCE_DATA_MISSING detail for a missing micro-export return tier. */
const EXPORT_RETURN_TIER_DETAIL = 'EXPORT_RETURN_TIER';

/** A key under the `profitBlockers` message namespace. */
export type ProfitBlockerReasonKey =
  | 'reasons.CARRIER_NOT_RECOGNIZED'
  | (typeof SHIPPING_DETAIL_KEYS)[ShippingDetail]
  | 'reasons.SHIPPING_ESTIMATE_UNAVAILABLE.RETURN'
  | 'reasons.SHIPPING_ESTIMATE_UNAVAILABLE.other'
  | 'reasons.REFERENCE_DATA_MISSING.EXPORT_RETURN_TIER'
  | 'reasons.REFERENCE_DATA_MISSING.other'
  | 'reasons.MISSING_COMMISSION_RATE'
  | 'reasons.MISSING_COST';

/** The next-intl key (under `profitBlockers`) and its values for one blocker. */
export interface ProfitBlockerMessage {
  key: ProfitBlockerReasonKey;
  values?: { providerName: string };
}

function isShippingDetail(detail: string): detail is ShippingDetail {
  return Object.keys(SHIPPING_DETAIL_KEYS).includes(detail);
}

function shippingReasonKey(detail: string | null): ProfitBlockerReasonKey {
  if (detail === null) return 'reasons.SHIPPING_ESTIMATE_UNAVAILABLE.other';
  if (detail.startsWith(RETURN_DETAIL_PREFIX))
    return 'reasons.SHIPPING_ESTIMATE_UNAVAILABLE.RETURN';
  if (isShippingDetail(detail)) return SHIPPING_DETAIL_KEYS[detail];
  return 'reasons.SHIPPING_ESTIMATE_UNAVAILABLE.other';
}

/**
 * Picks the sentence for one profit blocker. The API decides which issues block;
 * this only maps the blocker's code and detail to a message key. The carrier name
 * comes from the detail, or `unknownCarrierLabel` when the marketplace sent none.
 *
 * Returns null for a code that has no reason sentence: the non-blocking codes (the
 * API never lists them as blockers) and, at runtime, a code newer than this build.
 * A new code is a compile error here until it is handled.
 */
export function profitBlockerMessage(
  blocker: ProfitBlocker,
  unknownCarrierLabel: string,
): ProfitBlockerMessage | null {
  const { code, detail } = blocker;
  switch (code) {
    case 'CARRIER_NOT_RECOGNIZED': {
      const providerName = detail === null || detail.trim() === '' ? unknownCarrierLabel : detail;
      return { key: 'reasons.CARRIER_NOT_RECOGNIZED', values: { providerName } };
    }
    case 'SHIPPING_ESTIMATE_UNAVAILABLE':
      return { key: shippingReasonKey(detail) };
    case 'REFERENCE_DATA_MISSING':
      return {
        key:
          detail === EXPORT_RETURN_TIER_DETAIL
            ? 'reasons.REFERENCE_DATA_MISSING.EXPORT_RETURN_TIER'
            : 'reasons.REFERENCE_DATA_MISSING.other',
      };
    case 'MISSING_COMMISSION_RATE':
      return { key: 'reasons.MISSING_COMMISSION_RATE' };
    case 'MISSING_COST':
      return { key: 'reasons.MISSING_COST' };
    case 'UNMAPPED_MARKETPLACE_RECORD':
    case 'AMBIGUOUS_RECORD_MATCH':
    case 'SELLER_CARGO_AGREEMENT_ESTIMATE':
      return null;
    default: {
      // A code newer than this build must not crash the page: no sentence, no throw.
      const _exhaustive: never = code;
      void _exhaustive;
      return null;
    }
  }
}
