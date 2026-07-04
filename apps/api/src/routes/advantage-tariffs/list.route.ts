import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { listAdvantageTariffs } from '../../services/advantage-tariff.service';
import {
  AdvantageTariffListResponseSchema,
  AdvantageTariffStorePathSchema,
} from '../../validators/advantage-tariff.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const listAdvantageTariffsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/advantage-tariffs',
  tags: ['AdvantageTariffs'],
  summary: 'List saved Advantage product-label tariffs for a store',
  description:
    'Returns one row per saved Advantage product-label upload for the store, with the aggregates the ' +
    'master list shows: product count, how many products already have a chosen star tier, the ' +
    'exported flag and the last-updated timestamp. Newest first.',
  security: [{ bearerAuth: [] }],
  request: { params: AdvantageTariffStorePathSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: AdvantageTariffListResponseSchema } },
      description: 'Saved Advantage tariffs for the store',
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

app.openapi(listAdvantageTariffsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  const data = await listAdvantageTariffs(orgId, storeId);
  return c.json({ data }, 200);
});

export default app;
