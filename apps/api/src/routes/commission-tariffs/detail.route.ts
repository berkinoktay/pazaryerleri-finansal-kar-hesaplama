import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { getTariffDetail } from '../../services/commission-tariff.service';
import {
  CommissionTariffDetailSchema,
  TariffIdPathSchema,
} from '../../validators/commission-tariff.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const getTariffRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}',
  tags: ['CommissionTariffs'],
  summary: 'Get a saved commission tariff with computed per-band profit',
  description:
    'Returns the full tariff: its periods (date-range tabs) and, per product row, the four price ' +
    'bands with net profit and sale margin COMPUTED on read by the profit engine — the commission ' +
    'comes from the Excel band, everything else (cost, shipping, PSF, stoppage, VAT) from the same ' +
    'resolvers the Ürün Fiyatlandırma tool uses. Profit is never stored, so it always reflects the ' +
    'current cost / fee data. When a row cannot be costed (no catalog match, no cost profile, no ' +
    'shipping) `calculable` is false, `reason` explains why and every band profit is null. ' +
    '`bestBandKey` marks the most profitable band. Money fields are GROSS decimal strings.',
  security: [{ bearerAuth: [] }],
  request: { params: TariffIdPathSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: CommissionTariffDetailSchema } },
      description: 'The tariff with computed per-band profit',
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

app.openapi(getTariffRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, tariffId } = c.req.valid('param');
  const { store, role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  const detail = await getTariffDetail(orgId, storeId, store, tariffId);
  return c.json(detail, 200);
});

export default app;
