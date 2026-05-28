import { createRoute, z } from '@hono/zod-openapi';

import { prisma } from '@pazarsync/db';
import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { requireCapability } from '../../lib/require-capability';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { toCarrierResponse, updateShippingConfig } from '../../services/shipping-config.service';
import {
  ShippingConfigSchema,
  UpdateShippingConfigSchema,
} from '../../validators/shipping-config.validator';

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

const patchShippingConfigRoute = createRoute({
  method: 'patch',
  path: '/organizations/{orgId}/stores/{storeId}/shipping-config',
  tags: ['Shipping'],
  summary: 'Update store shipping config',
  description:
    'Sets the tariff source and (optionally) the default carrier for a store. ' +
    'Validation enforces a carrier is provided whenever `shippingTariffSource` is ' +
    'TRENDYOL_CONTRACT (422 SHIPPING_CARRIER_REQUIRED_FOR_TRENDYOL_CONTRACT). The carrier ' +
    'must belong to the same platform as the store (422 SHIPPING_CARRIER_PLATFORM_MISMATCH). ' +
    'Gated to OWNER/ADMIN because it changes how every product/order cost is estimated.',
  security: [{ bearerAuth: [] }],
  request: {
    params: pathParams,
    body: {
      content: { 'application/json': { schema: UpdateShippingConfigSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ShippingConfigSchema } },
      description: 'Updated shipping configuration',
      headers: RateLimitHeaders,
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    403: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Not a member of this organization or insufficient role',
    },
    404: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Store or shipping carrier not found',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description:
        'Validation failed (missing carrier for TRENDYOL_CONTRACT, or carrier platform ' +
        'does not match store platform)',
    },
    429: Common429Response,
  },
});

app.openapi(patchShippingConfigRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const input = c.req.valid('json');
  // Changing the tariff source / default carrier reshapes every downstream
  // shipping estimate (and therefore profit calculation) for this store —
  // STORES_CONFIGURE (OWNER/ADMIN), who see every store in the org; the
  // service query enforces store∈org.
  await requireCapability(userId, orgId, CAPABILITIES.STORES_CONFIGURE);

  const updated = await prisma.$transaction((tx) =>
    updateShippingConfig(orgId, storeId, input, tx),
  );

  return c.json(
    {
      shippingTariffSource: updated.shippingTariffSource,
      defaultShippingCarrier:
        updated.defaultShippingCarrier === null
          ? null
          : toCarrierResponse(updated.defaultShippingCarrier),
    },
    200,
  );
});

export default app;
