import { z } from '@hono/zod-openapi';

import { Platform, ShippingTariffSource } from '@pazarsync/db';

// Zod 4 takes the Prisma 7 object-style enum directly via `z.enum(...)`. Both
// `Platform` and `ShippingTariffSource` are emitted as `{...} as const` so the
// values are statically known and round-trip identical to the DB column.
export const ShippingTariffSourceSchema = z
  .enum(ShippingTariffSource)
  .openapi('ShippingTariffSource', {
    description: 'Which contract drives the shipping cost lookup for this store.',
    example: 'TRENDYOL_CONTRACT',
  });

export const ShippingCarrierSchema = z
  .object({
    id: z.string().uuid(),
    platform: z.enum(Platform),
    externalId: z.number().int(),
    code: z.string(),
    displayName: z.string(),
    supportsBaremDestek: z.boolean(),
    maxBaremDesi: z.number().int(),
    sortOrder: z.number().int(),
  })
  .openapi('ShippingCarrier');

export const ShippingConfigSchema = z
  .object({
    shippingTariffSource: ShippingTariffSourceSchema,
    defaultShippingCarrier: ShippingCarrierSchema.nullable(),
  })
  .openapi('ShippingConfig');

export const UpdateShippingConfigSchema = z
  .object({
    shippingTariffSource: ShippingTariffSourceSchema,
    defaultShippingCarrierId: z.string().uuid('INVALID_CARRIER_ID').nullable(),
  })
  .refine((v) => v.shippingTariffSource === 'OWN_CONTRACT' || v.defaultShippingCarrierId !== null, {
    message: 'SHIPPING_CARRIER_REQUIRED_FOR_TRENDYOL_CONTRACT',
    path: ['defaultShippingCarrierId'],
  })
  .openapi('UpdateShippingConfigInput');

export const OwnShippingTariffRowSchema = z
  .object({
    id: z.string().uuid(),
    desi: z.number().int(),
    priceNet: z.string(),
  })
  .openapi('OwnShippingTariffRow');

/**
 * Read-only response shape for the per-carrier tariff lookup. Both fee
 * tables are stringified Decimals (KDV hariç) — never floats — and the
 * Barem tier ranges are inclusive on both ends in keeping with the
 * existing seed data convention.
 */
export const CarrierDesiTariffRowSchema = z
  .object({
    desi: z.number().int(),
    priceNet: z.string(),
  })
  .openapi('CarrierDesiTariffRow');

export const CarrierBaremTariffRowSchema = z
  .object({
    minOrderAmount: z.string(),
    maxOrderAmount: z.string(),
    priceNet: z.string(),
  })
  .openapi('CarrierBaremTariffRow');

export const CarrierTariffsSchema = z
  .object({
    carrier: ShippingCarrierSchema,
    desiTariffs: z.array(CarrierDesiTariffRowSchema),
    baremTariffs: z.array(CarrierBaremTariffRowSchema),
  })
  .openapi('CarrierTariffs');

export type UpdateShippingConfigInput = z.infer<typeof UpdateShippingConfigSchema>;
