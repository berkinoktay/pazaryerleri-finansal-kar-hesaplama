/**
 * Frontend Zod validation schema for the cost profile form.
 *
 * Mirrors the backend `createCostProfileSchema` (apps/api/src/validators/cost-profile.validator.ts)
 * with the same two refines:
 *   1. MANUAL fxRateMode requires a non-null, positive manualFxRate
 *   2. TRY currency must use AUTO mode (rate is always 1)
 *
 * Enum values come from @pazarsync/db/enums — no string literals per
 * feedback_no_string_literal_enum_duplicates.
 */

import Decimal from 'decimal.js';
import { z } from 'zod';

import { CostProfileType, Currency, FxRateMode } from '@pazarsync/db/enums';

const VAT_RATES = [0, 1, 8, 10, 18, 20] as const;

export const costProfileFormSchema = z
  .object({
    name: z.string().min(1, { message: 'nameRequired' }).max(100, { message: 'nameTooLong' }),
    type: z.enum([
      CostProfileType.COGS,
      CostProfileType.PACKAGING,
      CostProfileType.SHIPPING,
      CostProfileType.SOFTWARE,
      CostProfileType.MARKETING,
      CostProfileType.OTHER,
    ]),
    currency: z.enum([Currency.TRY, Currency.USD, Currency.EUR]),
    amountGross: z
      .string()
      .min(1, { message: 'amountRequired' })
      .refine(
        (v) => {
          try {
            return new Decimal(v).gte(0);
          } catch {
            return false;
          }
        },
        { message: 'amountNegative' },
      ),
    vatRate: z
      .number()
      .int()
      .refine((v) => (VAT_RATES as readonly number[]).includes(v)),
    fxRateMode: z.enum([FxRateMode.AUTO, FxRateMode.MANUAL]),
    manualFxRate: z.string().nullable(),
    note: z.string().max(2000).nullable(),
  })
  .refine(
    (v) =>
      v.fxRateMode === FxRateMode.AUTO ||
      (v.manualFxRate !== null &&
        (() => {
          try {
            return new Decimal(v.manualFxRate!).gt(0);
          } catch {
            return false;
          }
        })()),
    { message: 'manualFxRateRequired', path: ['manualFxRate'] },
  )
  .refine((v) => v.currency !== Currency.TRY || v.fxRateMode === FxRateMode.AUTO, {
    message: 'tryMustUseAuto',
    path: ['fxRateMode'],
  });

export type CostProfileFormValues = z.infer<typeof costProfileFormSchema>;

export const VAT_RATE_OPTIONS = VAT_RATES;
