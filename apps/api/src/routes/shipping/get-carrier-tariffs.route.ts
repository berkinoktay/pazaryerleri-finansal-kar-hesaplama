import { createRoute, z } from '@hono/zod-openapi';

import { prisma } from '@pazarsync/db';

import { createSubApp } from '../../lib/create-hono-app';
import { ensureOrgMember } from '../../lib/ensure-org-member';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { getCarrierTariffs, toCarrierResponse } from '../../services/shipping-config.service';
import { CarrierTariffsSchema } from '../../validators/shipping-config.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const pathParams = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  carrierId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'carrierId', in: 'path' } }),
});

const getCarrierTariffsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/shipping-carriers/{carrierId}/tariffs',
  tags: ['Shipping'],
  summary: "Get a carrier's tariff tables",
  description:
    'Returns the desi-bazlı (NORMAL lane) tariff rows plus the Barem desteği ' +
    'tier table for a single shipping carrier. Tariff data is platform-wide ' +
    'reference (not tenant-scoped), but membership in the path org is still ' +
    'required. Returns 404 when the carrier id is unknown or has been ' +
    'deactivated — existence non-disclosure for inactive rows is consistent ' +
    'with `listShippingCarriers`.',
  security: [{ bearerAuth: [] }],
  request: { params: pathParams },
  responses: {
    200: {
      content: { 'application/json': { schema: CarrierTariffsSchema } },
      description: 'Carrier with its desi and (optional) Barem tariff tables',
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
      description: 'Carrier not found or inactive',
    },
    429: Common429Response,
  },
});

app.openapi(getCarrierTariffsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, carrierId } = c.req.valid('param');
  await ensureOrgMember(userId, orgId);

  const { carrier, desiTariffs, baremTariffs } = await prisma.$transaction((tx) =>
    getCarrierTariffs(carrierId, tx),
  );

  return c.json(
    {
      carrier: toCarrierResponse(carrier),
      desiTariffs: desiTariffs.map((row) => ({
        desi: row.desi,
        priceNet: row.priceNet.toString(),
      })),
      baremTariffs: baremTariffs.map((row) => ({
        minOrderAmount: row.minOrderAmount.toString(),
        maxOrderAmount: row.maxOrderAmount.toString(),
        priceNet: row.priceNet.toString(),
      })),
    },
    200,
  );
});

export default app;
