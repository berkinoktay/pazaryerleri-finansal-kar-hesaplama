import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { ensureOrgMember } from '../../lib/ensure-org-member';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import * as commissionRateListService from '../../services/commission-rate-list.service';
import {
  listCommissionRatesQuerySchema,
  ListCommissionRatesResponseSchema,
} from '../../validators/commission-rate.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const pathParams = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  storeId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'storeId', in: 'path' } }),
});

const listCommissionRatesRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/commission-rates',
  tags: ['CommissionRates'],
  summary: 'List marketplace commission rate tariff for a store',
  description:
    'Returns the imported commission tariff (categoryId × brandId × payment-term × ' +
    'segment-override) for the given store. Two rule families exist: CATEGORY (kategori-only) ' +
    'and CATEGORY_BRAND (kategori + marka). `ruleKind` is required because the two families ' +
    'have different cardinality and the productCount semantic differs. `productScope=active` ' +
    'restricts to combinations the store actually sells (approved Product with non-archived ' +
    'variant). Cursor pagination is sort-aware — reusing a cursor with a different sort ' +
    'returns 422 CURSOR_SORT_MISMATCH.',
  security: [{ bearerAuth: [] }],
  request: {
    params: pathParams,
    query: listCommissionRatesQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListCommissionRatesResponseSchema } },
      description: 'Paginated list of commission rate rows with per-row productCount',
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
      description: 'Store not found or belongs to a different organization',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description:
        'Invalid query params, cursor sort mismatch, or sort=product_count:desc without productScope=active',
    },
    429: Common429Response,
  },
});

app.openapi(listCommissionRatesRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const filters = c.req.valid('query');
  const organizationId = await ensureOrgMember(userId, orgId);

  const { data, nextCursor, hasMore } = await commissionRateListService.listCommissionRates(
    organizationId,
    storeId,
    {
      ruleKind: filters.ruleKind,
      productScope: filters.productScope,
      q: filters.q,
      sort: filters.sort,
      cursor: filters.cursor,
      limit: filters.limit,
    },
  );

  return c.json(
    {
      data,
      meta: {
        nextCursor,
        hasMore,
        limit: filters.limit,
      },
    },
    200,
  );
});

export default app;
