// Org-scoped sync-log routes (separate from the store-scoped ones in
// `product.routes.ts`). The store-scoped variants live alongside the
// product sync trigger because that's where they grew up; this file
// hosts the org-wide endpoint so the path-shape — `/organizations/:orgId/
// sync-logs` — has a natural home.

import { createRoute, z } from '@hono/zod-openapi';
import { syncLogService } from '@pazarsync/sync-core';

import { createSubApp } from '../lib/create-hono-app';
import { ensureOrgMember } from '../lib/ensure-org-member';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../openapi';
import { SyncLogListResponseSchema, toSyncLogResponse } from '../validators/product.validator';

const app = createSubApp<{
  Variables: { userId: string };
}>();

const orgSyncLogsParams = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
});

const orgSyncLogsQuery = z.object({
  active: z
    .enum(['true', 'false'])
    .optional()
    .openapi({
      param: { name: 'active', in: 'query' },
      description: 'When `true`, omit recent COMPLETED/FAILED rows and return only active syncs.',
    }),
});

// ─── GET /sync-logs (org-wide, active + recent) ───────────────────────

const listOrgSyncLogsRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/sync-logs',
  tags: ['Sync'],
  summary: 'List active + recent sync logs across the organization',
  description:
    'Returns every active sync (PENDING / RUNNING / FAILED_RETRYABLE) plus the last 5 ' +
    'completed/failed runs across every store the user can see. Drives the org-wide ' +
    'SyncBadge in the dashboard header (PR 5c). Active rows come first, sorted newest first.',
  security: [{ bearerAuth: [] }],
  request: { params: orgSyncLogsParams, query: orgSyncLogsQuery },
  responses: {
    200: {
      content: { 'application/json': { schema: SyncLogListResponseSchema } },
      description: 'Active + recent sync logs for the org',
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

app.openapi(listOrgSyncLogsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId } = c.req.valid('param');
  const { active } = c.req.valid('query');
  const organizationId = await ensureOrgMember(userId, orgId);
  const logs = await syncLogService.listOrgActiveAndRecent(organizationId, {
    activeOnly: active === 'true',
  });
  return c.json({ data: logs.map(toSyncLogResponse) }, 200);
});

export default app;
