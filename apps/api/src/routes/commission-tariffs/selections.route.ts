import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { updateSelections } from '../../services/commission-tariff.service';
import {
  TariffIdPathSchema,
  UpdateSelectionsBodySchema,
  UpdateSelectionsResponseSchema,
} from '../../validators/commission-tariff.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const updateSelectionsRoute = createRoute({
  method: 'patch',
  path: '/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/selections',
  tags: ['CommissionTariffs'],
  summary: 'Save band selections + custom prices for tariff items',
  description:
    "Persists the seller's chosen band (`band1`..`band4`, or null to clear) and optional custom " +
    'price per item, in a single bulk update. Items not belonging to this tariff/store are ignored. ' +
    'Selection happens client-side over the backend-computed margins; this only records the result. ' +
    'Returns how many items were updated.',
  security: [{ bearerAuth: [] }],
  request: {
    params: TariffIdPathSchema,
    body: {
      content: { 'application/json': { schema: UpdateSelectionsBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UpdateSelectionsResponseSchema } },
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
      description: 'Tariff or store not found in this organization',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Invalid selection payload',
    },
    429: Common429Response,
  },
});

app.openapi(updateSelectionsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, tariffId } = c.req.valid('param');
  const { selections } = c.req.valid('json');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const result = await updateSelections(orgId, storeId, tariffId, selections);
  return c.json(result, 200);
});

export default app;
