import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { updateDiscountList } from '../../services/discount-list.service';
import {
  DiscountListPathSchema,
  UpdateDiscountListBodySchema,
  UpdateDiscountListResponseSchema,
} from '../../validators/discount-list.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const updateDiscountListRoute = createRoute({
  method: 'patch',
  path: '/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}',
  tags: ['DiscountLists'],
  summary: 'Update a discount list configuration',
  description:
    'Full-replaces the discount configuration on the list row (discount type + its per-type ' +
    'parameters, campaign window, order limit); the display name changes only when provided. The same ' +
    "config validator that gates the import upload gates this body, so a combination Trendyol wouldn't " +
    'accept (e.g. a fixed price on a non-Nth discount) is a 422 VALIDATION_ERROR. Items are untouched.',
  security: [{ bearerAuth: [] }],
  request: {
    params: DiscountListPathSchema,
    body: {
      content: { 'application/json': { schema: UpdateDiscountListBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UpdateDiscountListResponseSchema } },
      description: 'Configuration updated',
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
      description: 'Invalid discount configuration',
    },
    429: Common429Response,
  },
});

app.openapi(updateDiscountListRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, listId } = c.req.valid('param');
  const patch = c.req.valid('json');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  const result = await updateDiscountList(orgId, storeId, listId, patch);
  return c.json(result, 200);
});

export default app;
