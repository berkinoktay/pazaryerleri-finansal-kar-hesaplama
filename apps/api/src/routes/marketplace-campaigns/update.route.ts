import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { updateMarketplaceCampaign } from '../../services/marketplace-campaign.service';
import {
  MarketplaceCampaignPathSchema,
  UpdateMarketplaceCampaignBodySchema,
  UpdateMarketplaceCampaignResponseSchema,
} from '../../validators/marketplace-campaign.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const updateMarketplaceCampaignRoute = createRoute({
  method: 'patch',
  path: '/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}',
  tags: ['MarketplaceCampaigns'],
  summary: 'Update a marketplace campaign configuration',
  description:
    'FULL-REPLACES the campaign configuration on the campaign row (discount type + its per-type ' +
    'parameters, the Trendyol funding rate and the campaign window); the display name changes only ' +
    'when provided. Send the WHOLE configuration on every call: an omitted field is reset, not ' +
    'preserved — in particular `trendyolFundingPct` defaults to "0", so omitting it zeroes the ' +
    'funding rate. The same config validator that gates the import upload gates this body, so a ' +
    "combination Trendyol wouldn't accept (e.g. a fixed price on a non-Nth campaign, or a funding " +
    'rate above 100) is a 422 VALIDATION_ERROR. Items are untouched, but every scenario is ' +
    'recomputed on the next detail read.',
  security: [{ bearerAuth: [] }],
  request: {
    params: MarketplaceCampaignPathSchema,
    body: {
      content: { 'application/json': { schema: UpdateMarketplaceCampaignBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UpdateMarketplaceCampaignResponseSchema } },
      description: 'Configuration updated',
      headers: RateLimitHeaders,
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    403: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Insufficient role to modify store data',
    },
    404: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Campaign or store not found in this organization',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Invalid campaign configuration',
    },
    429: Common429Response,
  },
});

app.openapi(updateMarketplaceCampaignRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, campaignId } = c.req.valid('param');
  const patch = c.req.valid('json');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const result = await updateMarketplaceCampaign(orgId, storeId, campaignId, patch);
  return c.json(result, 200);
});

export default app;
