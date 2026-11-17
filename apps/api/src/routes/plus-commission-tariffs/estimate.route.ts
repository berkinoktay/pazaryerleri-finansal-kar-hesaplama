import { createRoute } from '@hono/zod-openapi';
import { Decimal } from 'decimal.js';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { ValidationError } from '../../lib/errors';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import {
  estimatePlusItemPrice,
  type EstimatePlusPriceInput,
} from '../../services/plus-commission-tariff-estimate.service';
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
  summary: 'Estimate the profit breakdown for a Plus tariff item',
  description:
    'Computes the full profit breakdown (income + every expense line: commission, shipping, PSF, ' +
    'stoppage, VAT) for ONE Plus tariff item, reusing the same profit engine and resolvers (cost, ' +
    "shipping, fee definitions) the detail view uses - so an estimate at a scenario's price equals " +
    "that scenario's profit in the detail response. Two modes: pass `price` to price it under the " +
    'item\'s reduced Plus commission (the custom-price what-if), or pass `scenario: "current"` (no ' +
    "price) to price the item's own commission-base price at its current commission - the breakdown " +
    "then matches the detail row's `currentNetProfit` exactly. The current scenario uses the " +
    "item's current price when its commission-base price is unknown; with neither price known it " +
    'answers 422 (CURRENT_PRICE_UNKNOWN on `scenario`), and with an unknown current commission ' +
    "percent (the file's cell was blank or unreadable) it answers 422 " +
    '(CURRENT_COMMISSION_UNKNOWN on `scenario`). The price mode needs no stored price, so ' +
    'it works with an unknown Plus price upper limit too; with an unknown Plus commission ' +
    'offer it answers 422 (PLUS_COMMISSION_UNKNOWN on `price`). Read-only (POST only because it ' +
    'carries a body); no state changes. When the item is unmatched or uncostable, calculable is ' +
    'false, reason explains why and breakdown is null. Money fields are GROSS decimal strings.',
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
      description:
        'Invalid payload — malformed price (INVALID_CUSTOM_PRICE), a missing price in the ' +
        'custom-price mode (PRICE_REQUIRED), price sent with scenario:"current" ' +
        '(INVALID_ESTIMATE_MODE), scenario:"current" for an item with neither a ' +
        'commission-base price nor a current price (CURRENT_PRICE_UNKNOWN on `scenario`), ' +
        'scenario:"current" for an item whose current commission percent is unknown ' +
        '(CURRENT_COMMISSION_UNKNOWN on `scenario`), or a price for an item whose Plus ' +
        'commission offer is unknown (PLUS_COMMISSION_UNKNOWN on `price`)',
    },
    429: Common429Response,
  },
});

app.openapi(estimateRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, tariffId, itemId } = c.req.valid('param');
  const { price, scenario } = c.req.valid('json');
  const { role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  let input: EstimatePlusPriceInput;
  if (scenario === 'current') {
    input = { mode: 'current' };
  } else if (price !== undefined) {
    input = { mode: 'price', price: new Decimal(price) };
  } else {
    // Unreachable — the validator's superRefine requires `price` in the non-current
    // mode. This guard narrows `price` to a string without a type assertion.
    throw new ValidationError([{ field: 'price', code: 'PRICE_REQUIRED' }]);
  }

  const result = await estimatePlusItemPrice(orgId, storeId, tariffId, itemId, input);
  return c.json(result, 200);
});

export default app;
