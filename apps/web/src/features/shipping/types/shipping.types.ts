import type { components } from '@pazarsync/api-client';

/**
 * Generated API types re-exported under feature-local names so the rest
 * of the slice imports from one place. Mirrors the pattern in
 * features/costs/types and features/stores/api/list-stores.api.ts.
 *
 * `ShippingConfig` is hand-typed here rather than re-exported as
 * `components['schemas']['ShippingConfig']` because the generator
 * (openapi-typescript) encodes the backend's nullable allOf
 * (`defaultShippingCarrier`) as `ShippingCarrier & (Record<string, never> | null)`,
 * which is structurally `never | null`. The actual runtime wire shape
 * is either `ShippingCarrier` or `null` — what we encode here. The
 * same response body shape is used end-to-end (GET + PATCH), so a
 * single local alias serves both.
 */
export type ShippingCarrier = components['schemas']['ShippingCarrier'];

export interface ShippingConfig {
  shippingTariffSource: 'TRENDYOL_CONTRACT' | 'OWN_CONTRACT';
  defaultShippingCarrier: ShippingCarrier | null;
}

export type UpdateShippingConfigInput = components['schemas']['UpdateShippingConfigInput'];
export type OwnShippingTariffRow = components['schemas']['OwnShippingTariffRow'];

export type CarrierDesiTariffRow = components['schemas']['CarrierDesiTariffRow'];
export type CarrierBaremTariffRow = components['schemas']['CarrierBaremTariffRow'];
export type CarrierTariffs = components['schemas']['CarrierTariffs'];

/**
 * Local domain enums for shipping. ShippingTariffSource is also surfaced
 * by the generated OpenAPI schema (components['schemas']['ShippingTariffSource'])
 * but we re-declare a TypeScript-string-literal alias here so consumers
 * inside the feature don't have to dig through the components tree.
 *
 * ShippingTariffApplied and ShippingEstimateStatus do NOT have direct
 * top-level schema components in the OpenAPI spec (they ride on the
 * products list response item shape) — defining them here gives the
 * downstream PR 6 popover/state mapper one clear import target.
 */
export type ShippingTariffSource = 'TRENDYOL_CONTRACT' | 'OWN_CONTRACT';
export type ShippingTariffApplied = 'NORMAL' | 'BAREM' | 'OWN_CONTRACT';
export type ShippingEstimateStatus =
  | 'OK'
  | 'NO_CARRIER'
  | 'NO_DESI'
  | 'OWN_CONTRACT_EMPTY'
  | 'DESI_OVERFLOW';
