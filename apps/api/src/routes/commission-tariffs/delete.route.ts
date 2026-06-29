import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema } from '../../openapi';
import { deleteTariff } from '../../services/commission-tariff.service';
import { TariffIdPathSchema } from '../../validators/commission-tariff.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const deleteTariffRoute = createRoute({
  method: 'delete',
  path: '/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}',
  tags: ['CommissionTariffs'],
  summary: 'Delete a saved commission tariff',
  description:
    'Hard-deletes the tariff and (via cascade) its periods and product rows. A tariff id from ' +
    'another store returns 404, indistinguishable from a missing one.',
  security: [{ bearerAuth: [] }],
  request: { params: TariffIdPathSchema },
  responses: {
    204: { description: 'Tariff deleted' },
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
    429: Common429Response,
  },
});

app.openapi(deleteTariffRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, tariffId } = c.req.valid('param');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_WRITE);

  await deleteTariff(orgId, storeId, tariffId);
  return c.body(null, 204);
});

export default app;
