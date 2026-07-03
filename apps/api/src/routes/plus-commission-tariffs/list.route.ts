import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { listPlusTariffs } from '../../services/plus-commission-tariff.service';
import {
  PlusTariffListResponseSchema,
  PlusTariffStorePathSchema,
} from '../../validators/plus-commission-tariff.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const listPlusTariffsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs',
  tags: ['PlusCommissionTariffs'],
  summary: 'List saved Plus commission tariffs for a store',
  description:
    'Returns one row per saved Plus commission-tariff upload for the store, with the aggregates the ' +
    'master list shows: product count, how many products are already opted in to Plus, the ' +
    'exported flag, the overall validity (active/upcoming/past, or null when the period dates ' +
    'could not be parsed) and the last-updated timestamp. Newest first.',
  security: [{ bearerAuth: [] }],
  request: { params: PlusTariffStorePathSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: PlusTariffListResponseSchema } },
      description: 'Saved Plus commission tariffs for the store',
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

app.openapi(listPlusTariffsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  const data = await listPlusTariffs(orgId, storeId);
  return c.json({ data }, 200);
});

export default app;
