import { createRoute, z } from '@hono/zod-openapi';

import { prisma } from '@pazarsync/db';

import { createSubApp } from '../../lib/create-hono-app';
import { ensureOrgMember } from '../../lib/ensure-org-member';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { getShippingConfig, toCarrierResponse } from '../../services/shipping-config.service';
import { ShippingConfigSchema } from '../../validators/shipping-config.validator';

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

const getShippingConfigRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/shipping-config',
  tags: ['Shipping'],
  summary: 'Get store shipping config',
  description:
    'Returns the current shipping configuration for a store: which tariff source is in ' +
    'force (TRENDYOL_CONTRACT vs OWN_CONTRACT) and which carrier was designated as default. ' +
    'The full ShippingCarrier row is included when a carrier is set so the UI does not need ' +
    'a second round-trip.',
  security: [{ bearerAuth: [] }],
  request: { params: pathParams },
  responses: {
    200: {
      content: { 'application/json': { schema: ShippingConfigSchema } },
      description: 'Current shipping configuration',
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
    429: Common429Response,
  },
});

app.openapi(getShippingConfigRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const organizationId = await ensureOrgMember(userId, orgId);

  const config = await prisma.$transaction((tx) => getShippingConfig(organizationId, storeId, tx));

  return c.json(
    {
      shippingTariffSource: config.shippingTariffSource,
      defaultShippingCarrier:
        config.defaultShippingCarrier === null
          ? null
          : toCarrierResponse(config.defaultShippingCarrier),
    },
    200,
  );
});

export default app;
