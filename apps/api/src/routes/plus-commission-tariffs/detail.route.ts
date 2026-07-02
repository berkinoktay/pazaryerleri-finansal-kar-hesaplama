import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { getPlusTariffDetail } from '../../services/plus-commission-tariff.service';
import {
  PlusTariffDetailSchema,
  PlusTariffIdPathSchema,
} from '../../validators/plus-commission-tariff.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const getPlusTariffRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}',
  tags: ['PlusCommissionTariffs'],
  summary: 'Get a saved Plus commission tariff with computed per-scenario profit',
  description:
    'Returns the full Plus tariff: its periods (date-range tabs) and, per product row, the current ' +
    'and Plus commission scenarios with net profit and sale margin COMPUTED on read by the profit ' +
    'engine - the commission comes from the Excel row, everything else (cost, shipping, PSF, ' +
    'stoppage, VAT) from the same resolvers the product-pricing tool uses. Profit is never stored, ' +
    'so it always reflects the current cost / fee data. When a row cannot be costed (no catalog ' +
    'match, no cost profile, no shipping) calculable is false, reason explains why and every ' +
    'scenario profit is null. Money fields are GROSS decimal strings.',
  security: [{ bearerAuth: [] }],
  request: { params: PlusTariffIdPathSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: PlusTariffDetailSchema } },
      description: 'The tariff with computed per-scenario profit',
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

app.openapi(getPlusTariffRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, tariffId } = c.req.valid('param');
  const { store, role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  const detail = await getPlusTariffDetail(orgId, storeId, store, tariffId);
  return c.json(detail, 200);
});

export default app;
