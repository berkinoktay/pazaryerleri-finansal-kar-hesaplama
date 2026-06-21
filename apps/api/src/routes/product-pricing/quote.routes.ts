import { createRoute, z } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { assertCapability } from '../../lib/require-capability';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { quoteProductPrice } from '../../services/product-pricing.service';
import { prisma } from '@pazarsync/db';
import { QuoteInputSchema, QuoteResponseSchema } from '../../validators/product-pricing.validator';

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

const quoteProductPriceRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/product-pricing/quote',
  tags: ['ProductPricing'],
  summary: 'Solve sale price for a target margin, markup, or profit',
  description:
    'Given a single variant and a pricing target (margin %, markup %, or absolute profit in TRY), ' +
    "solves for the sale price that achieves that target. Assembles the variant's full " +
    'UnitEconomics (cost / commission / shipping / PSF / stoppage) and calls the Dilim 1 ' +
    '`solvePriceForTarget` engine. Returns `calculable: false` with a reason code when the ' +
    'target is unreachable or when required inputs (cost / shipping / commission) are missing. ' +
    'This is a read/compute operation — no data is persisted. Requires DATA_READ capability.',
  security: [{ bearerAuth: [] }],
  request: {
    params: pathParams,
    body: {
      content: {
        'application/json': { schema: QuoteInputSchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: QuoteResponseSchema } },
      description:
        'Solver result. Check `calculable` before reading `price`/`breakdown`. ' +
        '`calculable: false` is still a 200 — it means the target is valid but ' +
        'unachievable, not a request error.',
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
        'Invalid request body (Zod validation) or variant not found in this store ' +
        '(INVALID_REFERENCE — the variantId exists but does not belong to this store).',
    },
    429: Common429Response,
  },
});

app.openapi(quoteProductPriceRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const body = c.req.valid('json');
  const { store, role } = await requireStoreAccess(userId, orgId, storeId);
  assertCapability(role, CAPABILITIES.DATA_READ);

  // Run the quote inside a transaction so that all resolver calls share a
  // consistent DB snapshot for the duration of the request.
  const result = await prisma.$transaction(async (tx) => {
    return quoteProductPrice(tx, orgId, storeId, store, {
      variantId: body.variantId,
      target: body.target,
    });
  });

  return c.json(result, 200);
});

export default app;
