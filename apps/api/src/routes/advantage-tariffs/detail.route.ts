import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { getAdvantageTariffDetail } from '../../services/advantage-tariff.service';
import {
  AdvantageTariffDetailSchema,
  AdvantageTariffIdPathSchema,
} from '../../validators/advantage-tariff.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const getAdvantageTariffRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/advantage-tariffs/{tariffId}',
  tags: ['AdvantageTariffs'],
  summary: 'Get a saved Advantage tariff with computed per-tier profit',
  description:
    'Returns the full Advantage tariff: per product row, the current price scenario and each star ' +
    'tier (Avantaj / Çok Avantaj / Süper Avantaj) with net profit and sale margin COMPUTED on read by ' +
    "the profit engine. Each tier's reduced commission is resolved from the store's Commission Tariff " +
    '(a tier target price lands into a commission band) or falls back to the category rate; the ' +
    'detail also surfaces WHICH commission tariff/period supplied the rates (commissionSource). ' +
    'Profit is never stored, so it always reflects the current cost / fee data. When a row cannot be ' +
    'costed (no catalog match, no cost profile, no shipping, no commission) calculable is false, ' +
    'reason explains why and every scenario profit is null. Money fields are GROSS decimal strings.',
  security: [{ bearerAuth: [] }],
  request: { params: AdvantageTariffIdPathSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: AdvantageTariffDetailSchema } },
      description: 'The tariff with computed per-tier profit',
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
      description: 'Tariff or store not found in this organization',
    },
    429: Common429Response,
  },
});

app.openapi(getAdvantageTariffRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, tariffId } = c.req.valid('param');
  const { store, role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  const detail = await getAdvantageTariffDetail(orgId, storeId, store, tariffId);
  return c.json(detail, 200);
});

export default app;
