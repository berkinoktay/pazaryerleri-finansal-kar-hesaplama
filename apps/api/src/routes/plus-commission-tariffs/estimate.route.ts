import { createRoute } from '@hono/zod-openapi';
import { Decimal } from 'decimal.js';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { estimatePlusItemPrice } from '../../services/plus-commission-tariff-estimate.service';
import {
  EstimatePlusPriceBodySchema,
  EstimatePlusPriceResultSchema,
  PlusTariffItemIdPathSchema,
} from '../../validators/plus-commission-tariff.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const estimateRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/plus-commission-tariffs/{tariffId}/items/{itemId}/estimate',
  tags: ['PlusCommissionTariffs'],
  summary: 'Estimate the profit breakdown for a Plus tariff item at a given price',
  description:
    'Computes the full profit breakdown (income + every expense line: commission, shipping, PSF, ' +
    'stoppage, VAT) for ONE Plus tariff item at the requested price, reusing the same profit engine ' +
    'and resolvers (cost, shipping, fee definitions) the detail view uses - so an estimate at a ' +
    "scenario's price equals that scenario's profit in the detail response. Uses the item's reduced " +
    'Plus commission. Read-only (POST only because it carries a body); no state changes. When the ' +
    'item is unmatched or uncostable, calculable is false, reason explains why and breakdown is ' +
    'null. Money fields are GROSS decimal strings.',
  security: [{ bearerAuth: [] }],
  request: {
    params: PlusTariffItemIdPathSchema,
    body: {
      content: { 'application/json': { schema: EstimatePlusPriceBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: EstimatePlusPriceResultSchema } },
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
  const { price } = c.req.valid('json');
  const { store, role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  const result = await estimatePlusItemPrice(
    orgId,
    storeId,
    store,
    tariffId,
    itemId,
    new Decimal(price),
  );
  return c.json(result, 200);
});

export default app;
