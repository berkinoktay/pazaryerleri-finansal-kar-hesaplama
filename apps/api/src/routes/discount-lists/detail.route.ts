import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { getDiscountListDetail } from '../../services/discount-list.service';
import {
  DiscountListDetailSchema,
  DiscountListPathSchema,
} from '../../validators/discount-list.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const getDiscountListRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}',
  tags: ['DiscountLists'],
  summary: 'Get a saved discount list with per-item current + discounted scenarios',
  description:
    'Returns the full discount list: its configuration, a summary card (item / selected counts, per-' +
    'order discount cost, max total cost, average profit delta) and every item with the current and ' +
    'discounted price SCENARIOS. Profit is computed on read by the profit engine and never stored, so ' +
    'it always reflects the current cost / fee data. When a row cannot be costed calculable is false, ' +
    'reason explains why and every scenario profit is null. Money fields are GROSS decimal strings.',
  security: [{ bearerAuth: [] }],
  request: { params: DiscountListPathSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: DiscountListDetailSchema } },
      description: 'The list with per-item current + discounted scenarios',
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
      description: 'List or store not found in this organization',
    },
    429: Common429Response,
  },
});

app.openapi(getDiscountListRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, listId } = c.req.valid('param');
  const { store, role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  const detail = await getDiscountListDetail(orgId, storeId, store, listId);
  return c.json(detail, 200);
});

export default app;
