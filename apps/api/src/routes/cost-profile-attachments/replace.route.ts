import { createRoute, z } from '@hono/zod-openapi';

import { CAPABILITIES } from '@pazarsync/utils';

import { createSubApp } from '../../lib/create-hono-app';
import { requireCapability } from '../../lib/require-capability';
import { accessibleStoreIds } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import * as attachmentService from '../../services/cost-profile-attachment.service';
import { replaceBodySchema } from '../../validators/cost-profile-attachment.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const orgIdParam = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
});

const replaceResponseSchema = z
  .object({
    variantsAffected: z
      .number()
      .int()
      .openapi({ description: 'Number of variants whose profile set was replaced.' }),
    finalProfilesPerVariant: z
      .number()
      .int()
      .openapi({ description: 'Number of cost profiles now attached to each variant.' }),
    bufferEntriesPromoted: z.number().int().openapi({
      description:
        'Live Performance buffer entries flipped PENDING → PROMOTING because this replace made their order fully calculable.',
    }),
  })
  .openapi('ReplaceResponse');

const replaceRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/cost-profile-attachments/replace',
  tags: ['CostProfileAttachments'],
  summary: 'Replace cost profiles for product variants',
  description:
    'Atomically replaces the full set of cost profiles for each listed variant. ' +
    'After this call each variant in `variantIds` will be attached to exactly ' +
    '`profileIds` (and nothing else). Pass an empty `profileIds` array to clear all ' +
    'profiles from the listed variants.',
  security: [{ bearerAuth: [] }],
  request: {
    params: orgIdParam,
    body: {
      content: { 'application/json': { schema: replaceBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: replaceResponseSchema } },
      description: 'Profile sets replaced',
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
      description: 'One or more cost profiles not found',
    },
    409: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'One or more cost profiles are archived',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'One or more variants belong to a different organization, or validation failed',
    },
    429: Common429Response,
  },
});

app.openapi(replaceRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId } = c.req.valid('param');
  const { variantIds, profileIds } = c.req.valid('json');
  // DATA_WRITE blocks VIEWER; accessibleStoreIds narrows a MEMBER to granted
  // stores (null = OWNER/ADMIN). Same gate as attach — see attach.route.ts.
  const role = await requireCapability(userId, orgId, CAPABILITIES.DATA_WRITE);
  const storeIds = await accessibleStoreIds(userId, orgId, role);

  const result = await attachmentService.replaceCostProfilesForVariants(
    orgId,
    variantIds,
    profileIds,
    userId,
    storeIds,
  );

  return c.json(result, 200);
});

export default app;
