import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { updateDiscountSelections } from '../../services/discount-list.service';
import {
  DiscountListPathSchema,
  UpdateDiscountSelectionsBodySchema,
  UpdateDiscountSelectionsResponseSchema,
} from '../../validators/discount-list.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const updateDiscountSelectionsRoute = createRoute({
  method: 'patch',
  path: '/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}/selections',
  tags: ['DiscountLists'],
  summary: 'Toggle which discount list items are included',
  description:
    "Persists the seller's participation choice per item. mode 'set' updates the given rows one by one " +
    "(each { itemId, included }); mode 'all' includes and 'none' excludes the WHOLE list in a single " +
    'statement (so a 500-row list is one request). Items not belonging to this list/store are ignored. ' +
    'Returns how many items were updated.',
  security: [{ bearerAuth: [] }],
  request: {
    params: DiscountListPathSchema,
    body: {
      content: { 'application/json': { schema: UpdateDiscountSelectionsBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UpdateDiscountSelectionsResponseSchema } },
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

app.openapi(updateDiscountSelectionsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, listId } = c.req.valid('param');
  const { mode, selections } = c.req.valid('json');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const result = await updateDiscountSelections(orgId, storeId, listId, selections, mode);
  return c.json(result, 200);
});

export default app;
