import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { getFlashProductDetail } from '../../services/flash-product.service';
import {
  FlashProductDetailSchema,
  FlashProductListPathSchema,
} from '../../validators/flash-product.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const getFlashProductRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/flash-products/{listId}',
  tags: ['FlashProducts'],
  summary: 'Get a saved Flash Products list with computed per-scenario profit',
  description:
    'Returns the full Flash Products list: per offer row, the current price scenario and each present ' +
    'flash offer (24 Saatlik / 3 Saatlik) with net profit and sale margin COMPUTED on read by the ' +
    "profit engine. Each offer's reduced commission is READ from the store's Commission Tariff (the " +
    'offer\'s window resolves into a commission band) or falls back to the flat "Mevcut Komisyon" rate. ' +
    'Profit is never stored, so it always reflects the current cost / fee data. When a row cannot be ' +
    'costed (no catalog match, no cost profile, no shipping) calculable is false, reason explains why ' +
    'and every scenario profit is null. Money fields are GROSS decimal strings.',
  security: [{ bearerAuth: [] }],
  request: { params: FlashProductListPathSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: FlashProductDetailSchema } },
      description: 'The list with computed per-scenario profit',
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

app.openapi(getFlashProductRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, listId } = c.req.valid('param');
  const { store, role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  const detail = await getFlashProductDetail(orgId, storeId, store, listId);
  return c.json(detail, 200);
});

export default app;
