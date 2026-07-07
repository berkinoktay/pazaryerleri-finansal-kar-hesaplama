import { createRoute } from '@hono/zod-openapi';
import { Decimal } from 'decimal.js';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { ValidationError } from '../../lib/errors';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import {
  estimateFlashItemPrice,
  type EstimateFlashPriceInput,
} from '../../services/flash-product-estimate.service';
import {
  EstimateFlashPriceBodySchema,
  EstimateFlashPriceResultSchema,
  FlashProductItemPathSchema,
} from '../../validators/flash-product.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const estimateRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/flash-products/{listId}/items/{itemId}/estimate',
  tags: ['FlashProducts'],
  summary: 'Estimate the profit breakdown for a Flash Products item',
  description:
    'Computes the full profit breakdown (income + every expense line: commission, shipping, PSF, ' +
    'stoppage, VAT) for ONE flash item, reusing the same profit engine and resolvers (cost, shipping, ' +
    'fee definitions) the detail view uses - so an estimate at an offer price equals that offer’s ' +
    'profit in the detail response. Two modes: pass `price` to derive the reduced commission from the ' +
    "band that price lands in (of the item's primary window), else the flat rate (the custom-price " +
    'what-if); or pass `scenario: "current"` (no price) to price the item’s own customer price at its ' +
    'current commission - the breakdown then matches the detail row’s current baseline exactly. ' +
    'Read-only (POST only because it carries a body); no state changes. When the item is unmatched or ' +
    'uncostable, calculable is false, reason explains why and breakdown is null. Money fields are GROSS ' +
    'decimal strings.',
  security: [{ bearerAuth: [] }],
  request: {
    params: FlashProductItemPathSchema,
    body: {
      content: { 'application/json': { schema: EstimateFlashPriceBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: EstimateFlashPriceResultSchema } },
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
      description: 'Item, list or store not found in this organization',
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
  const { orgId, storeId, listId, itemId } = c.req.valid('param');
  const { price, scenario } = c.req.valid('json');
  const { store, role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  let input: EstimateFlashPriceInput;
  if (scenario === 'current') {
    input = { mode: 'current' };
  } else if (price !== undefined) {
    input = { mode: 'price', price: new Decimal(price) };
  } else {
    // Unreachable — the validator's superRefine requires `price` outside current mode.
    // This guard narrows `price` to a string without a type assertion.
    throw new ValidationError([{ field: 'price', code: 'PRICE_REQUIRED' }]);
  }

  const result = await estimateFlashItemPrice(orgId, storeId, store, listId, itemId, input);
  return c.json(result, 200);
});

export default app;
