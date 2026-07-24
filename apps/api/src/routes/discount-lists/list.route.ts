import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { listDiscountLists } from '../../services/discount-list.service';
import {
  DiscountListListResponseSchema,
  DiscountListStorePathSchema,
} from '../../validators/discount-list.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const listDiscountListsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/discount-lists',
  tags: ['DiscountLists'],
  summary: 'List saved discount lists for a store',
  description:
    'Returns one row per saved discount list for the store, with its discount configuration ' +
    '(type + per-type parameters), the item count, how many rows are already included, the exported ' +
    'flag and the last-updated timestamp. Money fields are GROSS decimal strings, dates ISO. ' +
    'Newest first.',
  security: [{ bearerAuth: [] }],
  request: { params: DiscountListStorePathSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: DiscountListListResponseSchema } },
      description: 'Saved discount lists for the store',
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

app.openapi(listDiscountListsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  const data = await listDiscountLists(orgId, storeId);
  return c.json({ data }, 200);
});

export default app;
