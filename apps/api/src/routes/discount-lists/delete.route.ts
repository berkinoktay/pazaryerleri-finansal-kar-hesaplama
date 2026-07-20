import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema } from '../../openapi';
import { deleteDiscountList } from '../../services/discount-list.service';
import { DiscountListPathSchema } from '../../validators/discount-list.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const deleteDiscountListRoute = createRoute({
  method: 'delete',
  path: '/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}',
  tags: ['DiscountLists'],
  summary: 'Delete a saved discount list',
  description:
    'Hard-deletes the list and (via cascade) its items. A list id from another store returns 404, ' +
    'indistinguishable from a missing one.',
  security: [{ bearerAuth: [] }],
  request: { params: DiscountListPathSchema },
  responses: {
    204: { description: 'List deleted' },
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
    429: Common429Response,
  },
});

app.openapi(deleteDiscountListRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, listId } = c.req.valid('param');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  await deleteDiscountList(orgId, storeId, listId);
  return c.body(null, 204);
});

export default app;
