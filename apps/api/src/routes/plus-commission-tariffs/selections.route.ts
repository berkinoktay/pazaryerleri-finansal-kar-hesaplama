import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { updatePlusSelections } from '../../services/plus-commission-tariff.service';
import {
  PlusTariffIdPathSchema,
  UpdatePlusSelectionsBodySchema,
  UpdatePlusSelectionsResponseSchema,
} from '../../validators/plus-commission-tariff.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const updatePlusSelectionsRoute = createRoute({
  method: 'patch',
  path: '/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}/selections',
  tags: ['PlusCommissionTariffs'],
  summary: 'Save Plus opt-in + custom prices for tariff items',
  description:
    "Persists the seller's Plus opt-in (selected true/false) and optional custom price per item, in " +
    'a single bulk update. Items not belonging to this tariff/store are ignored. Selection happens ' +
    'client-side over the backend-computed margins; this only records the result. Returns how many ' +
    'items were updated.',
  security: [{ bearerAuth: [] }],
  request: {
    params: PlusTariffIdPathSchema,
    body: {
      content: { 'application/json': { schema: UpdatePlusSelectionsBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UpdatePlusSelectionsResponseSchema } },
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

app.openapi(updatePlusSelectionsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, tariffId } = c.req.valid('param');
  const { selections } = c.req.valid('json');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const result = await updatePlusSelections(orgId, storeId, tariffId, selections);
  return c.json(result, 200);
});

export default app;
