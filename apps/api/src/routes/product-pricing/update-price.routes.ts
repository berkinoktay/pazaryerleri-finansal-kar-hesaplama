import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { ForbiddenError } from '../../lib/errors';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { updateVariantSalePrice } from '../../services/price-write.service';
import {
  UpdatePriceInputSchema,
  UpdatePriceResponseSchema,
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

const updatePriceRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/product-pricing/price',
  tags: ['ProductPricing'],
  summary: "Write a variant's new sale price to the marketplace (live, irreversible)",
  description:
    "Pushes a single variant's new sale price to the marketplace (Trendyol). This is a LIVE, " +
    'IRREVERSIBLE write — the product is offered at the new price on the storefront and Trendyol ' +
    'allows only one price change per barcode per day. Restricted to OWNER and ADMIN roles; a ' +
    'MEMBER or VIEWER receives 403. Every call is recorded in an audit log (PriceChangeLog). ' +
    'The marketplace processes the change asynchronously: the endpoint submits the batch, then ' +
    'polls a short bounded window. On confirmed success the local sale price is updated and ' +
    "`status: 'SUCCESS'` is returned; if the marketplace does not confirm in time the local " +
    "price is left unchanged and `status: 'PENDING'` is returned (the change may still apply " +
    'upstream). A per-item rejection by the marketplace is a 422 MARKETPLACE_WRITE_FAILED.',
  security: [{ bearerAuth: [] }],
  request: {
    params: pathParams,
    body: {
      content: {
        'application/json': { schema: UpdatePriceInputSchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UpdatePriceResponseSchema } },
      description:
        "Price write outcome. `status: 'SUCCESS'` means the marketplace confirmed the item and " +
        "the local sale price was updated. `status: 'PENDING'` means the batch was accepted but " +
        'not confirmed within the polling window — the local price was NOT changed.',
      headers: RateLimitHeaders,
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    403: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description:
        'Not a member of this organization, or the caller is a MEMBER/VIEWER (only OWNER/ADMIN ' +
        'may write prices)',
    },
    404: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description:
        'Store not found / belongs to another organization, or the variant does not exist in ' +
        'this store (existence non-disclosure)',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description:
        'Invalid request body (Zod validation), corrupted store credentials, or the marketplace ' +
        'rejected the price item (MARKETPLACE_WRITE_FAILED / MARKETPLACE_AUTH_FAILED)',
    },
    429: Common429Response,
  },
});

app.openapi(updatePriceRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const body = c.req.valid('json');

  // Gate 1: store access (org membership + store→org ownership + grant for MEMBER/VIEWER).
  const { store, role } = await requireStoreAccess(userId, orgId, storeId);

  // Gate 2: OWNER/ADMIN only. A live, irreversible marketplace write is stricter
  // than the generic DATA_WRITE capability (which a MEMBER carries) — the owner
  // decided only OWNER/ADMIN may push prices (plan §OWNER DECISIONS). The detail
  // is generic so it does not map out the privilege surface.
  if (role !== 'OWNER' && role !== 'ADMIN') {
    throw new ForbiddenError('Insufficient capability');
  }

  const result = await updateVariantSalePrice(orgId, storeId, store, {
    variantId: body.variantId,
    salePrice: body.salePrice,
    userId,
  });

  return c.json(result, 200);
});

export default app;
