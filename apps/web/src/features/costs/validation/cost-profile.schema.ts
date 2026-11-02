/**
 * Frontend Zod validation schema for the cost profile form.
 *
 * Mirrors the backend `createCostProfileSchema`
 * (apps/api/src/validators/cost-profile.validator.ts).
 *
 * Enum values come from @pazarsync/db/enums — no string literals per
 * feedback_no_string_literal_enum_duplicates.
 */

import Decimal from 'decimal.js';
import { z } from 'zod';

import { CostProfileType } from '@pazarsync/db/enums';

const VAT_RATES = [0, 1, 8, 10, 18, 20] as const;

export const costProfileFormSchema = z.object({
  name: z.string().min(1, { message: 'nameRequired' }).max(100, { message: 'nameTooLong' }),
  type: z.enum([
    CostProfileType.COGS,
    CostProfileType.PACKAGING,
    CostProfileType.SHIPPING,
    CostProfileType.SOFTWARE,
    CostProfileType.MARKETING,
    CostProfileType.OTHER,
  ]),
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
  note: z.string().max(2000).nullable(),
});

export type CostProfileFormValues = z.infer<typeof costProfileFormSchema>;

export const VAT_RATE_OPTIONS = VAT_RATES;
