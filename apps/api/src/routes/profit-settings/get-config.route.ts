import { createRoute, z } from '@hono/zod-openapi';

import { prisma } from '@pazarsync/db';

import { createSubApp } from '../../lib/create-hono-app';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { getProfitSettings } from '../../services/profit-settings.service';
import { ProfitSettingsSchema } from '../../validators/profit-settings.validator';

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

const getProfitSettingsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/profit-settings',
  tags: ['Profit'],
  summary: 'Get store profit-formula settings',
  description:
    'Returns the resolved per-store profit-formula toggles (defaults applied): whether the ' +
    '%1 e-ticaret stopajı is subtracted, and whether negative net VAT (a VAT receivable) is ' +
    'included in profit. These are applied to orders as they are created (snapshot-at-create); ' +
    'changing them does not recompute existing orders.',
  security: [{ bearerAuth: [] }],
  request: { params: pathParams },
  responses: {
    200: {
      content: { 'application/json': { schema: ProfitSettingsSchema } },
      description: 'Resolved profit-formula settings',
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

app.openapi(getProfitSettingsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  await requireStoreAccess(userId, orgId, storeId);

  const settings = await prisma.$transaction((tx) => getProfitSettings(orgId, storeId, tx));

  return c.json(settings, 200);
});

export default app;
