import { createRoute } from '@hono/zod-openapi';
import { Decimal } from 'decimal.js';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { ValidationError } from '../../lib/errors';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import {
  estimateAdvantageItemPrice,
  type EstimateAdvantagePriceInput,
} from '../../services/advantage-tariff-estimate.service';
import {
  AdvantageTariffItemIdPathSchema,
  EstimateAdvantagePriceBodySchema,
  EstimateAdvantagePriceResultSchema,
} from '../../validators/advantage-tariff.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const estimateRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/advantage-tariffs/{tariffId}/items/{itemId}/estimate',
  tags: ['AdvantageTariffs'],
  summary: 'Estimate the profit breakdown for an Advantage tariff item',
  description:
    'Computes the full profit breakdown (income + every expense line: commission, shipping, PSF, ' +
    'stoppage, VAT) for ONE Advantage tariff item, reusing the same profit engine and resolvers ' +
    '(cost, shipping, fee definitions) the detail view uses - so an estimate at a tier target price ' +
    "equals that tier's profit in the detail response. Two modes: pass `price` to derive the reduced " +
    'commission from the band that price lands in, else the category rate (the custom-price what-if); ' +
    'or pass `scenario: "current"` (no price) to price the item’s own customer price at its current ' +
    'commission - the breakdown then matches the detail row’s `current` exactly. Read-only (POST only ' +
    'because it carries a body); no state changes. When the item is unmatched or uncostable, ' +
    'calculable is false, reason explains why and breakdown is null. Money fields are GROSS decimal ' +
    'strings.',
  security: [{ bearerAuth: [] }],
  request: {
    params: AdvantageTariffItemIdPathSchema,
    body: {
      content: { 'application/json': { schema: EstimateAdvantagePriceBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: EstimateAdvantagePriceResultSchema } },
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
      description:
        'Invalid payload — malformed price (INVALID_CUSTOM_PRICE), a missing price in the ' +
        'custom-price mode (PRICE_REQUIRED), or a price sent with scenario:"current" ' +
        '(INVALID_ESTIMATE_MODE)',
    },
    429: Common429Response,
  },
});

app.openapi(estimateRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, tariffId, itemId } = c.req.valid('param');
  const { price, scenario } = c.req.valid('json');
  const { store, role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  let input: EstimateAdvantagePriceInput;
  if (scenario === 'current') {
    input = { mode: 'current' };
  } else if (price !== undefined) {
    input = { mode: 'price', price: new Decimal(price) };
  } else {
    // Unreachable — the validator's superRefine requires `price` outside current
    // mode. This guard narrows `price` to a string without a type assertion.
    throw new ValidationError([{ field: 'price', code: 'PRICE_REQUIRED' }]);
  }

  const result = await estimateAdvantageItemPrice(orgId, storeId, store, tariffId, itemId, input);
  return c.json(result, 200);
});

export default app;
