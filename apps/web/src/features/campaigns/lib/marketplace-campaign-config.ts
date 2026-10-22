import { z } from 'zod';

import { DiscountType } from '@pazarsync/db/enums';

import {
  DECIMAL_RE,
  discountConfigFieldsSchema,
  refineDiscountConfigForm,
} from './discount-config';

/**
 * Client-side config model for the Kampanyalar upload + edit forms. A Trendyol campaign carries
 * the same kurgu (type + per-type parameters) and the same campaign window as an İndirimler list,
 * so the form EXTENDS the shared discount fields and reuses the same per-type rules — mirroring
 * the backend, where `MarketplaceCampaignConfigFieldsSchema` reuses `refineDiscountConfig`. Two
 * differences: the kurgu set drops CODE (a coupon is not a separate campaign type), and the form
 * carries Trendyol's funding rate. The one-line summary reuses `useDescribeDiscountConfig`.
 */

/** The five kurgu the Kampanyalar page offers (mirror of the backend `CAMPAIGN_DISCOUNT_TYPES`). */
export const CAMPAIGN_DISCOUNT_TYPES = [
  DiscountType.NET,
  DiscountType.CONDITIONAL_BASKET,
  DiscountType.CONDITIONAL_QUANTITY,
  DiscountType.BUY_X_PAY_Y,
  DiscountType.NTH_PRODUCT,
] as const;

// Trendyol can fund the whole discount but never more than it.
const MAX_FUNDING_PCT = 100;

/**
 * The Kampanyalar config form. An empty funding rate resolves to "0" — the seller bears the whole
 * discount, the pessimistic floor the backend defaults to as well — so a valid submit always
 * carries an explicit rate.
 */
export const campaignConfigFormSchema = discountConfigFieldsSchema
  .extend({
    discountType: z.enum(CAMPAIGN_DISCOUNT_TYPES),
    trendyolFundingPct: z.string().regex(DECIMAL_RE, 'INVALID_FUNDING_PCT').default('0'),
  })
  .superRefine((val, ctx) => {
    refineDiscountConfigForm(val, ctx);
    if (Number(val.trendyolFundingPct) > MAX_FUNDING_PCT) {
      ctx.addIssue({
        code: 'custom',
        message: 'FUNDING_PCT_OVER_100',
        path: ['trendyolFundingPct'],
      });
    }
  });

/** What the form's fields hold — the funding rate may still be empty. */
export type CampaignConfigFormInput = z.input<typeof campaignConfigFormSchema>;

/** What a valid submit produces — the funding rate resolved to an explicit value. */
export type CampaignConfigFormValues = z.output<typeof campaignConfigFormSchema>;
