import { createRoute, z } from '@hono/zod-openapi';

import { Platform, prisma } from '@pazarsync/db';

import { createSubApp } from '../../lib/create-hono-app';
import { ensureOrgMember } from '../../lib/ensure-org-member';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { listShippingCarriers, toCarrierResponse } from '../../services/shipping-config.service';
import { ShippingCarrierSchema } from '../../validators/shipping-config.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const pathParams = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
});

const queryParams = z.object({
  platform: z.enum(Platform).optional().openapi({
    description: 'Optional platform filter. Returns all carriers when omitted.',
    example: 'TRENDYOL',
  }),
});

const listCarriersRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/shipping-carriers',
  tags: ['Shipping'],
  summary: 'List shipping carriers',
  description:
    'Returns the global, read-only catalogue of shipping carriers (Trendyol Express, ' +
    'Yurtici Kargo, Aras Kargo, …) optionally filtered by platform. Carriers are seeded ' +
    'by the system — they are not per-tenant resources, only `Store.defaultShippingCarrierId` is.',
  security: [{ bearerAuth: [] }],
  request: {
    params: pathParams,
    query: queryParams,
  },
  responses: {
    200: {
      content: {
        'application/json': { schema: z.object({ data: z.array(ShippingCarrierSchema) }) },
      },
      description: 'List of active carriers, sorted by `sortOrder` ascending',
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
    429: Common429Response,
  },
});

app.openapi(listCarriersRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId } = c.req.valid('param');
  const { platform } = c.req.valid('query');
  await ensureOrgMember(userId, orgId);

  const carriers = await prisma.$transaction((tx) => listShippingCarriers({ platform }, tx));

  return c.json(
    {
      data: carriers.map(toCarrierResponse),
    },
    200,
  );
});

export default app;
