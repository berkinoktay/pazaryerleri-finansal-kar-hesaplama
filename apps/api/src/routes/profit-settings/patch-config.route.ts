import { createRoute, z } from '@hono/zod-openapi';

import { prisma } from '@pazarsync/db';
import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { requireCapability } from '../../lib/require-capability';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { updateProfitSettings } from '../../services/profit-settings.service';
import {
  ProfitSettingsSchema,
  UpdateProfitSettingsSchema,
} from '../../validators/profit-settings.validator';

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

const patchProfitSettingsRoute = createRoute({
  method: 'patch',
  path: '/organizations/{orgId}/stores/{storeId}/profit-settings',
  tags: ['Profit'],
  summary: 'Update store profit-formula settings',
  description:
    'Shallow-merges the provided profit-formula toggles into the store (omitted keys are left ' +
    'unchanged). SNAPSHOT-AT-CREATE: the change only affects orders created afterwards — ' +
    'existing orders keep their stored profit values. Gated to OWNER/ADMIN because it changes ' +
    'how every new order’s profit is computed.',
  security: [{ bearerAuth: [] }],
  request: {
    params: pathParams,
    body: {
      content: { 'application/json': { schema: UpdateProfitSettingsSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ProfitSettingsSchema } },
      description: 'Updated (resolved) profit-formula settings',
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
      description: 'Store not found or belongs to a different organization',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Validation failed (a toggle is not a boolean)',
    },
    429: Common429Response,
  },
});

app.openapi(patchProfitSettingsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const input = c.req.valid('json');
  // Changing the profit-formula toggles reshapes how every newly-created order's profit is
  // computed — STORES_CONFIGURE (OWNER/ADMIN), who see every store in the org; the service
  // query enforces store∈org.
  await requireCapability(userId, orgId, CAPABILITIES.STORES_CONFIGURE);

  const updated = await prisma.$transaction((tx) =>
    updateProfitSettings(orgId, storeId, input, tx),
  );

  return c.json(updated, 200);
});

export default app;
