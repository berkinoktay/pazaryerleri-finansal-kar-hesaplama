import type { ShippingEstimateStatus } from '../types/shipping.types';

/**
 * Visual contract for a `ShippingEstimateStatus` cell — one icon char,
 * one semantic color, optionally an i18n key for the error reason.
 *
 * The five statuses ship distinct cues:
 *   - OK                  → blue ⓘ   (informational, "tap for breakdown")
 *   - NO_DESI             → yellow ! (seller can fix on the product)
 *   - NO_CARRIER          → yellow ! (seller can fix in store settings)
 *   - OWN_CONTRACT_EMPTY  → gray ●   (V1 placeholder, no action yet)
 *   - DESI_OVERFLOW       → red !    (carrier swap needed)
 *
 * NO_DESI / NO_CARRIER share the same color (yellow) — both are
 * "configuration missing" failures the seller is expected to resolve.
 * The popover copy disambiguates which one is missing.
 */
export interface StatusVisual {
  iconColor: 'blue' | 'yellow' | 'red' | 'gray';
  iconChar: 'ⓘ' | '!' | '●';
  /** Present for non-OK statuses. Points at the `shipping.products.states.<status>` namespace. */
  i18nKey?: `shipping.products.states.${Exclude<ShippingEstimateStatus, 'OK'>}`;
}

export function statusToVisual(status: ShippingEstimateStatus): StatusVisual {
  switch (status) {
    case 'OK':
      return { iconColor: 'blue', iconChar: 'ⓘ' };
    case 'NO_DESI':
      return { iconColor: 'yellow', iconChar: '!', i18nKey: 'shipping.products.states.NO_DESI' };
    case 'NO_CARRIER':
      return { iconColor: 'yellow', iconChar: '!', i18nKey: 'shipping.products.states.NO_CARRIER' };
    case 'OWN_CONTRACT_EMPTY':
      return {
        iconColor: 'gray',
        iconChar: '●',
        i18nKey: 'shipping.products.states.OWN_CONTRACT_EMPTY',
      };
    case 'DESI_OVERFLOW':
      return {
        iconColor: 'red',
        iconChar: '!',
        i18nKey: 'shipping.products.states.DESI_OVERFLOW',
      };
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled shipping estimate status: ${String(_exhaustive)}`);
    }
  }
}
