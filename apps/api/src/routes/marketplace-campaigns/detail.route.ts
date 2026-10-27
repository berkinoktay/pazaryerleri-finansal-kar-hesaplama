import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { getMarketplaceCampaignDetail } from '../../services/marketplace-campaign.service';
import {
  MarketplaceCampaignDetailSchema,
  MarketplaceCampaignPathSchema,
} from '../../validators/marketplace-campaign.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const getMarketplaceCampaignRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}',
  tags: ['MarketplaceCampaigns'],
  summary: 'Get a saved campaign with per-item current / max / custom price scenarios',
  description:
    'Returns the full campaign: its configuration (including the Trendyol funding rate), which ' +
    'commission tariff period fed the bands, and every item with THREE price scenarios — the ' +
    "current price (not participating), the maximum price Trendyol allows, and the seller's own " +
    'custom price (null when none is saved). Basket-scoped campaign types additionally carry the ' +
    'settlement scenario for a single-product basket: the assumed quantity, what the customer ' +
    "pays, what Trendyol funds and the order-level profit — framed on the item's SAVED price " +
    'choice. Profit is computed on read by the profit engine and never stored, so it always ' +
    'reflects the current cost / fee data. When a row cannot be costed calculable is false, ' +
    'reason explains why and every scenario profit is null. Money fields are GROSS decimal strings.',
  security: [{ bearerAuth: [] }],
  request: { params: MarketplaceCampaignPathSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: MarketplaceCampaignDetailSchema } },
      description: 'The campaign with per-item current / max / custom scenarios',
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
      description: 'Campaign or store not found in this organization',
    },
    429: Common429Response,
  },
});

app.openapi(getMarketplaceCampaignRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, campaignId } = c.req.valid('param');
  const { store, role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  const detail = await getMarketplaceCampaignDetail(orgId, storeId, store, campaignId);
  return c.json(detail, 200);
});

export default app;
