import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { ensureOrgMember } from '../../lib/ensure-org-member';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import * as attachmentService from '../../services/cost-profile-attachment.service';
import { attachmentBodySchema } from '../../validators/cost-profile-attachment.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const orgIdParam = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
});

const attachResponseSchema = z
  .object({
    attached: z.number().int().openapi({ description: 'Number of new link rows created.' }),
    bufferEntriesPromoted: z.number().int().openapi({
      description:
        'Live Performance buffer entries flipped PENDING → PROMOTING because this attach made their order fully calculable.',
    }),
  })
  .openapi('AttachResponse');

const attachRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/cost-profile-attachments/attach',
  tags: ['CostProfileAttachments'],
  summary: 'Attach cost profiles to product variants',
  description:
    'Links every profileId to every variantId (Cartesian product). Idempotent — ' +
    'duplicate pairs are silently skipped. Returns the count of new link rows created. ' +
    'All profileIds must belong to the organization and must not be archived. ' +
    'All variantIds must belong to the organization.',
  security: [{ bearerAuth: [] }],
  request: {
    params: orgIdParam,
    body: {
      content: { 'application/json': { schema: attachmentBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: attachResponseSchema } },
      description: 'Profiles attached (or already linked)',
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

app.openapi(attachRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId } = c.req.valid('param');
  const { profileIds, variantIds } = c.req.valid('json');
  const organizationId = await ensureOrgMember(userId, orgId);

  const result = await attachmentService.attachCostProfiles(
    organizationId,
    profileIds,
    variantIds,
    userId,
  );

  return c.json(result, 200);
});

export default app;
