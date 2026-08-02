import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { estimateCampaignItem } from '../../services/marketplace-campaign-estimate.service';
import {
  EstimateCampaignItemBodySchema,
  EstimateCampaignItemResultSchema,
  MarketplaceCampaignItemPathSchema,
} from '../../validators/marketplace-campaign.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const estimateCampaignItemRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/items/{itemId}/estimate',
  tags: ['MarketplaceCampaigns'],
  summary: 'Estimate the profit breakdown for one campaign item under one scenario',
  description:
    'Computes the full profit breakdown (income plus every expense line: commission, shipping, ' +
    'platform service, stoppage, VAT) for ONE campaign item under the chosen scenario, reusing the ' +
    'same profit engine and resolvers the detail view uses — so the modal never disagrees with the ' +
    'row. `scenario: "current"` prices the item campaign-free at its current price; `"max"` prices ' +
    'it at the maximum Trendyol allows; `"custom"` prices the seller\'s own price, taken from the ' +
    'request body when given (the screen buffers it before saving) and from the stored value ' +
    "otherwise. A custom price above the item's maximum is refused with 422 CUSTOM_PRICE_ABOVE_MAX, " +
    'and a custom scenario with no price anywhere with 422 CUSTOM_PRICE_REQUIRED. `price` is what ' +
    'the SELLER earns; `customerPaidUnitPrice` and `trendyolFundedUnitAmount` split one unit into ' +
    'what the customer pays and what Trendyol funds (both null for the campaign-free scenario). ' +
    '`breakdownScope` follows the campaign’s presentation — an ORDER-presentation campaign returns ' +
    'the whole assumed basket for EVERY scenario, including `current`. Read-only (POST only because ' +
    'it carries a body); no state changes. Money fields are GROSS decimal strings.',
  security: [{ bearerAuth: [] }],
  request: {
    params: MarketplaceCampaignItemPathSchema,
    body: {
      content: { 'application/json': { schema: EstimateCampaignItemBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: EstimateCampaignItemResultSchema } },
      description: 'The profit breakdown for the chosen scenario',
      headers: RateLimitHeaders,
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    403: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Not a member of this organization',
    },
    404: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Item, campaign or store not found in this organization',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description:
        'Invalid payload — an unknown scenario, a custom price above the item maximum, or a ' +
        'custom scenario with no price',
    },
    429: Common429Response,
  },
});

app.openapi(estimateCampaignItemRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, campaignId, itemId } = c.req.valid('param');
  const body = c.req.valid('json');
  const { store, role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  const result = await estimateCampaignItem(orgId, storeId, store, campaignId, itemId, body);
  return c.json(result, 200);
});

export default app;
