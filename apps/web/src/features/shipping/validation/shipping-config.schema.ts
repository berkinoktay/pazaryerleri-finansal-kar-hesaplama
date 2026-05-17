import { z } from 'zod';

/**
 * Client-side mirror of the backend's UpdateShippingConfigInput schema.
 *
 * The cross-field invariant — "TRENDYOL_CONTRACT requires a non-null
 * carrier id" — is enforced via `superRefine` so it lives next to the
 * shape definition (one source of truth for both the client-side form
 * validator and the inline error path). The error code matches the
 * backend's domain error `SHIPPING_CARRIER_REQUIRED_FOR_TRENDYOL_CONTRACT`
 * so the same i18n message lights up whether the failure is caught
 * locally before submit or surfaced from a backend 422.
 */
export const ShippingConfigFormSchema = z
  .object({
    shippingTariffSource: z.enum(['TRENDYOL_CONTRACT', 'OWN_CONTRACT']),
    defaultShippingCarrierId: z.string().uuid().nullable(),
  })
  .superRefine((value, ctx) => {
    if (
      value.shippingTariffSource === 'TRENDYOL_CONTRACT' &&
      (value.defaultShippingCarrierId === null || value.defaultShippingCarrierId.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaultShippingCarrierId'],
        message: 'SHIPPING_CARRIER_REQUIRED_FOR_TRENDYOL_CONTRACT',
      });
    }
  });

export type ShippingConfigFormValues = z.infer<typeof ShippingConfigFormSchema>;
