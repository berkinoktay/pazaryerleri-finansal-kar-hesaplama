import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import * as claimService from '../../services/claim.service';
import { ListClaimsResponseSchema, listClaimsQuerySchema } from '../../validators/claim.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const storeScopeParams = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  storeId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'storeId', in: 'path' } }),
});

const listClaimsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/claims',
  tags: ['Claims'],
  summary: 'List return claims for a store',
  description:
    'Returns paginated return claims (Trendyol iade talepleri) sorted by claimDate desc, ' +
    'with composable filters: status tab (open/resolved), date range (from/to on claimDate), ' +
    'and a substring search (q) over platformOrderNumber and trendyolClaimId. Each row ' +
    'carries derived fields (derivedStatus, scope, product/reason summaries) so the UI ' +
    'renders without recomputation. Populated by the 6h CLAIMS sync worker.',
  security: [{ bearerAuth: [] }],
  request: {
    params: storeScopeParams,
    query: listClaimsQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListClaimsResponseSchema } },
      description: 'Paginated list of return claims',
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
      description: 'Store not found',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Invalid query params',
    },
    429: Common429Response,
  },
});

app.openapi(listClaimsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const filters = c.req.valid('query');
  await requireStoreAccess(userId, orgId, storeId);

  const { data, total, counts } = await claimService.listClaims(orgId, storeId, filters);

  const totalPages = total === 0 ? 0 : Math.ceil(total / filters.perPage);

  return c.json(
    {
      data,
      pagination: {
        page: filters.page,
        perPage: filters.perPage,
        total,
        totalPages,
      },
      counts,
    },
    200,
  );
});

export default app;
