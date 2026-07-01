import { createRoute } from '@hono/zod-openapi';
import { Decimal } from 'decimal.js';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { estimateItemPrice } from '../../services/commission-tariff-estimate.service';
import {
  EstimateItemPriceBodySchema,
  EstimateItemPriceResultSchema,
  TariffItemIdPathSchema,
} from '../../validators/commission-tariff.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const estimateRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/commission-tariffs/{tariffId}/items/{itemId}/estimate',
  tags: ['CommissionTariffs'],
  summary: 'Estimate the profit breakdown for a tariff item at a given price',
  description:
    'Computes the full profit breakdown (income + every expense line: commission, shipping, PSF, ' +
    'stoppage, VAT) for ONE tariff item at the requested price, reusing the same profit engine and ' +
    'resolvers (cost, shipping, fee definitions) the detail view uses — so an estimate at a band’s ' +
    'price equals that band’s profit in the detail response. Two modes: pass `bandKey` to use that ' +
    'band’s commission verbatim (the band-click breakdown modal), or omit it to derive the band from ' +
    'the price (the custom-price what-if). Read-only (POST only because it carries a body); no state ' +
    'changes. When the item is unmatched or uncostable, `calculable` is false, `reason` explains why ' +
    'and `breakdown` is null. Money fields are GROSS decimal strings.',
  security: [{ bearerAuth: [] }],
  request: {
    params: TariffItemIdPathSchema,
    body: {
      content: { 'application/json': { schema: EstimateItemPriceBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: EstimateItemPriceResultSchema } },
      description: 'The profit breakdown at the requested price',
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
      description: 'Item, tariff or store not found in this organization',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Invalid price payload',
    },
    429: Common429Response,
  },
});

app.openapi(estimateRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, tariffId, itemId } = c.req.valid('param');
  const { price, bandKey } = c.req.valid('json');
  const { store, role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  const result = await estimateItemPrice(orgId, storeId, store, tariffId, itemId, {
    price: new Decimal(price),
    bandKey: bandKey ?? null,
  });
  return c.json(result, 200);
});

export default app;
