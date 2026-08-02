import { createRoute } from '@hono/zod-openapi';
import { Decimal } from 'decimal.js';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { suggestCampaignTargetMargin } from '../../services/marketplace-campaign-estimate.service';
import {
  MarketplaceCampaignPathSchema,
  TargetMarginBodySchema,
  TargetMarginResultSchema,
} from '../../validators/marketplace-campaign.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const campaignTargetMarginRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/marketplace-campaigns/{campaignId}/target-margin',
  tags: ['MarketplaceCampaigns'],
  summary: 'Suggest a campaign price per item for a target net margin',
  description:
    'For every item in the campaign, computes the SMALLEST campaign price whose net margin ' +
    'reaches `targetMarginPct`, capped at the item\'s "Maksimum Girebileceğin Fiyat". The ' +
    'commission is anchored on the maximum price’s band, so a suggestion that lands in a cheaper ' +
    'band is optimistic and the row’s own scenario shows the real figure. An item whose target no ' +
    'price reaches comes back with reason UNREACHABLE; one missing cost, shipping or commission ' +
    'with NOT_CALCULABLE. Suggestions arrive in the campaign’s own row order.\n\n' +
    'This endpoint COMPUTES AND RETURNS — it writes NOTHING. The client puts the suggested prices ' +
    'into its local buffer and they become persistent only when the seller saves through the ' +
    'selections endpoint, so the seller’s choices keep a single source of truth. POST only because ' +
    'it carries a body. Money fields are GROSS decimal strings.',
  security: [{ bearerAuth: [] }],
  request: {
    params: MarketplaceCampaignPathSchema,
    body: {
      content: { 'application/json': { schema: TargetMarginBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: TargetMarginResultSchema } },
      description: 'A suggested price (or a reason) per campaign item — nothing was persisted',
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
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Invalid payload — a malformed target margin',
    },
    429: Common429Response,
  },
});

app.openapi(campaignTargetMarginRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, campaignId } = c.req.valid('param');
  const { targetMarginPct } = c.req.valid('json');
  const { store, role } = await requireStoreAccess(userId, orgId, storeId);
  // DATA_READ, not DATA_WRITE: the suggestion never leaves the response body.
  assertCapability(role, CAPABILITIES.DATA_READ);

  const result = await suggestCampaignTargetMargin(
    orgId,
    storeId,
    store,
    campaignId,
    new Decimal(targetMarginPct),
  );
  return c.json(result, 200);
});

export default app;
