import { createRoute, z } from '@hono/zod-openapi';

import { prisma } from '@pazarsync/db';

import { createSubApp } from '../../lib/create-hono-app';
import { ensureOrgMember } from '../../lib/ensure-org-member';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { listOwnShippingTariff } from '../../services/shipping-config.service';
import { OwnShippingTariffRowSchema } from '../../validators/shipping-config.validator';

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

const listOwnTariffRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/own-shipping-tariff',
  tags: ['Shipping'],
  summary: 'List own contract shipping tariff rows',
  description:
    'Returns the tenant-private shipping price table used when the store is on ' +
    'OWN_CONTRACT. V1: this list is always empty because Excel/CSV upload is not yet ' +
    'shipped; the endpoint exists so the frontend can render the "yakında" empty state ' +
    'and pre-wire the data path for V2.',
  security: [{ bearerAuth: [] }],
  request: { params: pathParams },
  responses: {
    200: {
      content: {
        'application/json': { schema: z.object({ data: z.array(OwnShippingTariffRowSchema) }) },
      },
      description: 'Tariff rows ordered by `desi` ascending (empty in V1)',
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

app.openapi(listOwnTariffRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const organizationId = await ensureOrgMember(userId, orgId);

  const rows = await prisma.$transaction((tx) =>
    listOwnShippingTariff(organizationId, storeId, tx),
  );

  return c.json(
    {
      data: rows.map((r) => ({
        id: r.id,
        desi: r.desi,
        priceNet: r.priceNet.toString(),
      })),
    },
    200,
  );
});

export default app;
