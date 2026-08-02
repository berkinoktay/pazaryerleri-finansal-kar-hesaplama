import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema } from '../../openapi';
import { deleteMarketplaceCampaign } from '../../services/marketplace-campaign.service';
import { MarketplaceCampaignPathSchema } from '../../validators/marketplace-campaign.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const deleteMarketplaceCampaignRoute = createRoute({
  method: 'delete',
  path: '/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}',
  tags: ['MarketplaceCampaigns'],
  summary: 'Delete a saved marketplace campaign',
  description:
    'Hard-deletes the campaign and (via cascade) its items. A campaign id from another store ' +
    'returns 404, indistinguishable from a missing one.',
  security: [{ bearerAuth: [] }],
  request: { params: MarketplaceCampaignPathSchema },
  responses: {
    204: { description: 'Campaign deleted' },
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
    429: Common429Response,
  },
});

app.openapi(deleteMarketplaceCampaignRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, campaignId } = c.req.valid('param');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  await deleteMarketplaceCampaign(orgId, storeId, campaignId);
  return c.body(null, 204);
});

export default app;
