import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { listTariffs } from '../../services/commission-tariff.service';
import {
  CommissionTariffListResponseSchema,
  TariffStorePathSchema,
} from '../../validators/commission-tariff.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const listTariffsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/commission-tariffs',
  tags: ['CommissionTariffs'],
  summary: 'List saved commission tariffs for a store',
  description:
    'Returns one row per saved commission-tariff upload for the store, with the aggregates the ' +
    'master list shows: product count, how many products already have a band selected, the ' +
    'exported flag, the overall validity (active/upcoming/past, or null when the period dates ' +
    'could not be parsed) and the last-updated timestamp. Newest first.',
  security: [{ bearerAuth: [] }],
  request: { params: TariffStorePathSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: CommissionTariffListResponseSchema } },
      description: 'Saved commission tariffs for the store',
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

app.openapi(listTariffsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  const data = await listTariffs(orgId, storeId);
  return c.json({ data }, 200);
});

export default app;
