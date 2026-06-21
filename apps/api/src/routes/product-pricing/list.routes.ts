import { createRoute, z } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { listProductPricing } from '../../services/product-pricing.service';
import {
  ListProductPricingQuerySchema,
  ListProductPricingResponseSchema,
} from '../../validators/product-pricing.validator';

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

const listProductPricingRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/product-pricing',
  tags: ['ProductPricing'],
  summary: 'List per-variant forward profit for a store',
  description:
    'Returns one forward-pricing row per APPROVED ProductVariant. Each row assembles a ' +
    'single-unit profit from the existing cost / commission / shipping / PSF / stoppage ' +
    'resolvers and the profit engine. Rows are ALWAYS returned — even when a variant cannot ' +
    'be costed — so the user can see which input is missing: the three independent status ' +
    'fields (costStatus, shippingEstimateStatus, commissionStatus) surface the gap, and ' +
    '`calculable` is their conjunction. When calculable=false, netProfit / saleMarginPct / ' +
    'costMarkupPct are null. Money fields are GROSS (VAT-inclusive) decimal strings. Each row ' +
    'also carries `imageUrl` (primary image), `cost` (GROSS TRY, null unless costStatus=OK), and ' +
    'category/brand ids + names. Every approved variant is computed in memory, then filtered, ' +
    'sorted and paginated server-side, so `total`/`totalPages` reflect the FILTERED set exactly. ' +
    'Filters: `calculableOnly=true` (actionable rows only), `profitStatus` (profitable/breakeven/' +
    'loss/all), `marginMin`/`marginMax` (sale margin %), `categoryId`/`brandId` (SQL). Sorts: ' +
    'salePrice/title (SQL columns) plus netProfit/saleMarginPct/costMarkupPct (computed values, ' +
    'null sorts last). Offset/page-based pagination — `page` is 1-indexed, `perPage` is locked to ' +
    '{10, 25, 50, 100} with a default of 25. All financial math is computed in the backend; the ' +
    'frontend only renders these strings.',
  security: [{ bearerAuth: [] }],
  request: {
    params: pathParams,
    query: ListProductPricingQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListProductPricingResponseSchema } },
      description: 'Paginated list of per-variant pricing rows with per-row calculability',
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
      description: 'Invalid query params',
    },
    429: Common429Response,
  },
});

app.openapi(listProductPricingRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const filters = c.req.valid('query');
  const { store, role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  // The service computes EVERY approved variant in memory, then filters / sorts /
  // paginates in memory, so `total` is the EXACT filtered count (calculableOnly,
  // profitStatus, margin range and category/brand all applied before the slice).
  const { data, total } = await listProductPricing(orgId, storeId, store, {
    page: filters.page,
    perPage: filters.perPage,
    q: filters.q,
    sortBy: filters.sortBy,
    calculableOnly: filters.calculableOnly,
    profitStatus: filters.profitStatus,
    marginMin: filters.marginMin,
    marginMax: filters.marginMax,
    categoryId: filters.categoryId,
    brandId: filters.brandId,
  });

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
    },
    200,
  );
});

export default app;
