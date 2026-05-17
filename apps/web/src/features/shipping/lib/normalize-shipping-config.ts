import type { ShippingCarrier, ShippingConfig } from '../types/shipping.types';

/**
 * Bridge from the generated openapi-fetch response shape to the local
 * `ShippingConfig`. The backend's OpenAPI spec models the embedded
 * carrier as `allOf [ShippingCarrier, { type: ['object', 'null'] }]`,
 * which openapi-typescript renders as
 * `ShippingCarrier & (Record<string, never> | null)` — the intersection
 * collapses to `never | null` at the type level even though the runtime
 * payload is either a populated `ShippingCarrier` or `null`. We type-
 * narrow at runtime: if `defaultShippingCarrier` looks like an object
 * with the carrier's required `id` field, accept it as `ShippingCarrier`;
 * otherwise treat it as `null`. Centralizing the bridge in one helper
 * keeps the rest of the feature out of the generator quirk.
 */
interface WireShippingCarrierLike {
  id?: unknown;
  platform?: unknown;
  externalId?: unknown;
  code?: unknown;
  displayName?: unknown;
  supportsBaremDestek?: unknown;
  maxBaremDesi?: unknown;
  sortOrder?: unknown;
}

interface WireShippingConfig {
  shippingTariffSource: 'TRENDYOL_CONTRACT' | 'OWN_CONTRACT';
  defaultShippingCarrier: WireShippingCarrierLike | null;
}

function isShippingCarrier(value: WireShippingCarrierLike | null): value is ShippingCarrier {
  if (value === null) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.platform === 'string' &&
    typeof value.externalId === 'number' &&
    typeof value.code === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.supportsBaremDestek === 'boolean' &&
    typeof value.maxBaremDesi === 'number' &&
    typeof value.sortOrder === 'number'
  );
}

export function normalizeShippingConfig(wire: WireShippingConfig): ShippingConfig {
  return {
    shippingTariffSource: wire.shippingTariffSource,
    defaultShippingCarrier: isShippingCarrier(wire.defaultShippingCarrier)
      ? wire.defaultShippingCarrier
      : null,
  };
}
