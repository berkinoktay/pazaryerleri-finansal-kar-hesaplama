import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { updateFlashSelections } from '../../services/flash-product.service';
import {
  FlashProductListPathSchema,
  UpdateFlashSelectionsBodySchema,
  UpdateFlashSelectionsResponseSchema,
} from '../../validators/flash-product.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const updateFlashSelectionsRoute = createRoute({
  method: 'patch',
  path: '/organizations/{orgId}/stores/{storeId}/flash-products/{listId}/selections',
  tags: ['FlashProducts'],
  summary: 'Save flash offer choice + custom prices for list items',
  description:
    "Persists the seller's chosen flash offer (H24 / H3, or null to clear) and optional custom price " +
    'per item, in a single bulk update. An offer and a custom price are mutually exclusive (the client ' +
    'enforces the XOR). Items not belonging to this list/store are ignored. Selection happens ' +
    'client-side over the backend-computed margins; this only records the result. Returns how many ' +
    'items were updated.',
  security: [{ bearerAuth: [] }],
  request: {
    params: FlashProductListPathSchema,
    body: {
      content: { 'application/json': { schema: UpdateFlashSelectionsBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UpdateFlashSelectionsResponseSchema } },
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
      description: 'List or store not found in this organization',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Invalid selection payload',
    },
    429: Common429Response,
  },
});

app.openapi(updateFlashSelectionsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, listId } = c.req.valid('param');
  const { selections } = c.req.valid('json');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const result = await updateFlashSelections(orgId, storeId, listId, selections);
  return c.json(result, 200);
});

export default app;
