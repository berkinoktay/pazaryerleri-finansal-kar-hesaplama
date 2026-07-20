import { createRoute } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { estimateDiscountItem } from '../../services/discount-list-estimate.service';
import {
  DiscountListItemPathSchema,
  EstimateDiscountItemBodySchema,
  EstimateDiscountItemResultSchema,
} from '../../validators/discount-list.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const estimateRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/discount-lists/{listId}/items/{itemId}/estimate',
  tags: ['DiscountLists'],
  summary: 'Estimate the profit breakdown for a discount list item',
  description:
    'Computes the full profit breakdown (income + every expense line: commission, shipping, PSF, ' +
    'stoppage, VAT) for ONE discount item under the chosen scenario, reusing the same profit engine ' +
    'and resolvers (the three-tier commission chain, cost, shipping, fee definitions) the detail view ' +
    'uses — so the modal never disagrees with the detail row. Pass `scenario: "current"` to price the ' +
    'item at its current price, or `scenario: "discounted"` to price it at the list discount applied to ' +
    'that price; either way the reduced commission is RE-resolved on the scenario price (a lower price ' +
    'can land in a different commission band). Read-only (POST only because it carries a body); no state ' +
    'changes. When the item is unmatched, uncostable or has no resolvable commission, calculable is ' +
    'false, reason explains why and breakdown is null. Money fields are GROSS decimal strings.',
  security: [{ bearerAuth: [] }],
  request: {
    params: DiscountListItemPathSchema,
    body: {
      content: { 'application/json': { schema: EstimateDiscountItemBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: EstimateDiscountItemResultSchema } },
      description: 'The profit breakdown for the chosen scenario',
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
      description: 'Invalid payload — an unknown scenario value',
    },
    429: Common429Response,
  },
});

app.openapi(estimateRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId, listId, itemId } = c.req.valid('param');
  const { scenario } = c.req.valid('json');
  const { store, role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  const result = await estimateDiscountItem(orgId, storeId, store, listId, itemId, scenario);
  return c.json(result, 200);
});

export default app;
