import { z } from '@hono/zod-openapi';

/**
 * Per-store profit-formula toggles. SNAPSHOT-AT-CREATE: a change only affects orders
 * created AFTER it — historical orders keep their stored values (see @pazarsync/profit
 * estimate-on-order-create snapshot logic).
 *
 * GET returns the RESOLVED shape (defaults applied: includeStopaj=true,
 * includeNegativeNetVat=false). PATCH accepts a partial object and shallow-merges it
 * (omitting a key leaves it unchanged).
 */
export const ProfitSettingsSchema = z
  .object({
    includeStopaj: z.boolean(),
    includeNegativeNetVat: z.boolean(),
  })
  .openapi('ProfitSettings', {
    description:
      'Resolved per-store profit-formula toggles. includeStopaj: subtract the %1 e-ticaret ' +
      'stopajı from net profit. includeNegativeNetVat: when net VAT is negative (a VAT ' +
      'receivable), include it in profit (true) or clamp it to 0 (false). Micro-export orders ' +
      'always include negative net VAT regardless of this flag (structural export-VAT reclaim).',
    example: { includeStopaj: true, includeNegativeNetVat: false },
  });

export const UpdateProfitSettingsSchema = z
  .object({
    includeStopaj: z.boolean().optional(),
    includeNegativeNetVat: z.boolean().optional(),
  })
  .openapi('UpdateProfitSettingsInput', {
    description:
      'Partial profit-formula toggles to shallow-merge into the store. Omitted keys are left ' +
      'unchanged. Only affects orders created after the change (snapshot-at-create).',
    example: { includeNegativeNetVat: true },
  });

export type UpdateProfitSettingsInput = z.infer<typeof UpdateProfitSettingsSchema>;
