import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { listMarketplaceCampaigns } from '../../services/marketplace-campaign.service';
import {
  MarketplaceCampaignListResponseSchema,
  MarketplaceCampaignStorePathSchema,
} from '../../validators/marketplace-campaign.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const listMarketplaceCampaignsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/marketplace-campaigns',
  tags: ['MarketplaceCampaigns'],
  summary: 'List saved marketplace campaigns for a store',
  description:
    'Returns one row per saved campaign for the store, with its campaign configuration (type + ' +
    "per-type parameters), Trendyol's funding rate, the item count, how many items already carry " +
    'a price choice, the exported flag and the last-updated timestamp. Money fields are GROSS ' +
    'decimal strings, dates ISO. Newest first.',
  security: [{ bearerAuth: [] }],
  request: { params: MarketplaceCampaignStorePathSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: MarketplaceCampaignListResponseSchema } },
      description: 'Saved marketplace campaigns for the store',
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
      description: 'Store not found or belongs to a different organization',
    },
    429: Common429Response,
  },
});

app.openapi(listMarketplaceCampaignsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  const data = await listMarketplaceCampaigns(orgId, storeId);
  return c.json({ data }, 200);
});

export default app;
