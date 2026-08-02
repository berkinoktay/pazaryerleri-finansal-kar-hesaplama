import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { updateCampaignSelections } from '../../services/marketplace-campaign.service';
import {
  MarketplaceCampaignPathSchema,
  UpdateCampaignSelectionsBodySchema,
  UpdateCampaignSelectionsResponseSchema,
} from '../../validators/marketplace-campaign.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const updateCampaignSelectionsRoute = createRoute({
  method: 'patch',
  path: '/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/selections',
  tags: ['MarketplaceCampaigns'],
  summary: 'Save the per-item campaign price choices',
  description:
    "Persists the seller's price choice per item. mode 'set' writes the given rows one by one " +
    "(each { itemId, selection, customPrice }); mode 'all' applies the MAX price option and " +
    "'none' clears participation across the WHOLE campaign in a single statement (so a 500-row " +
    'campaign is one request). `customPrice` is stored independently of the selection, so a seller ' +
    "can keep a typed price while participating at the maximum — and 'all'/'none' never discard it. " +
    'A custom price above the item\'s "Maksimum Girebileceğin Fiyat" is rejected with 422 ' +
    'CUSTOM_PRICE_ABOVE_MAX (Trendyol refuses such a price on re-upload). Items not belonging to ' +
    'this campaign/store are ignored. Returns how many items were updated.',
  security: [{ bearerAuth: [] }],
  request: {
    params: MarketplaceCampaignPathSchema,
    body: {
      content: { 'application/json': { schema: UpdateCampaignSelectionsBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UpdateCampaignSelectionsResponseSchema } },
      description: 'Selections saved',
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
      description: 'Invalid selection payload, or a custom price above the item maximum',
    },
    429: Common429Response,
  },
});

app.openapi(updateCampaignSelectionsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, campaignId } = c.req.valid('param');
  const { mode, selections } = c.req.valid('json');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const result = await updateCampaignSelections(orgId, storeId, campaignId, selections, mode);
  return c.json(result, 200);
});

export default app;
