import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema } from '../../openapi';
import { deleteFlashProductList } from '../../services/flash-product.service';
import { FlashProductListPathSchema } from '../../validators/flash-product.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const deleteFlashProductRoute = createRoute({
  method: 'delete',
  path: '/organizations/{orgId}/stores/{storeId}/flash-products/{listId}',
  tags: ['FlashProducts'],
  summary: 'Delete a saved Flash Products list',
  description:
    'Hard-deletes the list and (via cascade) its offer rows. A list id from another store returns ' +
    '404, indistinguishable from a missing one.',
  security: [{ bearerAuth: [] }],
  request: { params: FlashProductListPathSchema },
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

app.openapi(deleteFlashProductRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, listId } = c.req.valid('param');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  await deleteFlashProductList(orgId, storeId, listId);
  return c.body(null, 204);
});

export default app;
