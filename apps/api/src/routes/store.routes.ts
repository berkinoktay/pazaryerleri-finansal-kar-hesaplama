import { createRoute, z } from '@hono/zod-openapi';
import type { MemberRole } from '@pazarsync/db';

import { RATE_LIMITS } from '../config/rate-limits';
import { createSubApp } from '../lib/create-hono-app';
import { ensureOrgMember } from '../lib/ensure-org-member';
import { rateLimit } from '../middleware/rate-limit.middleware';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../openapi';
import * as storeService from '../services/store.service';
import {
  ConnectStoreInputSchema,
  StoreListResponseSchema,
  StoreSingleResponseSchema,
} from '../validators/store.validator';

const app = createSubApp<{
  Variables: {
    userId: string;
    organizationId: string;
    memberRole: MemberRole;
  };
}>();

// D7 — connect-store rate limit: 5 attempts per minute per user.
// Applied only to POST via direct invocation inside the handler.
// Numbers live in `config/rate-limits.ts`.
const connectRateLimit = rateLimit(RATE_LIMITS.STORE_CONNECT);

const orgIdParam = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
});
const storeIdParams = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  storeId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'storeId', in: 'path' } }),
});

const listStoresRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores',
  tags: ['Stores'],
  summary: 'List connected stores for an organization',
  description:
    'Returns every store belonging to the organization, ordered by most-recently-created first. ' +
    'Credentials are never included in the response — the column is write-only from the API.',
  security: [{ bearerAuth: [] }],
  request: { params: orgIdParam },
  responses: {
    200: {
      content: { 'application/json': { schema: StoreListResponseSchema } },
      description: 'List of stores',
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

app.openapi(listStoresRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId } = c.req.valid('param');
  const organizationId = await ensureOrgMember(userId, orgId);
  const data = await storeService.list(organizationId);
  return c.json({ data }, 200);
});

const connectStoreRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores',
  tags: ['Stores'],
  summary: 'Connect a marketplace account to the organization',
  description:
    'Validates credentials against the marketplace BEFORE persisting. A failed probe ' +
    'leaves no DB row. Credentials are AES-256-GCM encrypted at rest. Only TRENDYOL is ' +
    'wired in this phase; sending HEPSIBURADA returns 422 at the Zod discriminator. ' +
    'Rate-limited at 5 requests per minute per user.',
  security: [{ bearerAuth: [] }],
  request: {
    params: orgIdParam,
    body: {
      content: { 'application/json': { schema: ConnectStoreInputSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: StoreSingleResponseSchema } },
      description: 'Store connected',
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
    409: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'This marketplace account is already connected to the organization',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description:
        'Validation failed — request body invalid, sandbox gated in prod, platform not yet ' +
        'supported, or marketplace rejected the credentials',
    },
    429: Common429Response,
    503: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Marketplace is unreachable',
    },
  },
});

app.openapi(connectStoreRoute, async (c) => {
  // Route-level D7 rate limit: consume a token BEFORE validating. A
  // throw here produces 429; otherwise we proceed. Routes are a handler
  // not a middleware chain with @hono/zod-openapi, so invoking the
  // rate-limit function directly (no-op next) gives us the same effect.
  await connectRateLimit(c, async () => {});

  const userId = c.get('userId');
  const { orgId } = c.req.valid('param');
  // Connecting a marketplace account is OWNER/ADMIN territory: it
  // commits the org to billing-bearing API calls and stores credentials
  // that can fetch financial data. Members and viewers cannot do this.
  const organizationId = await ensureOrgMember(userId, orgId, {
    allowedRoles: ['OWNER', 'ADMIN'],
  });
  const input = c.req.valid('json');
  const store = await storeService.connect(organizationId, input);
  return c.json(store, 201);
});

const getStoreRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}',
  tags: ['Stores'],
  summary: 'Get a single store',
  security: [{ bearerAuth: [] }],
  request: { params: storeIdParams },
  responses: {
    200: {
      content: { 'application/json': { schema: StoreSingleResponseSchema } },
      description: 'The store',
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
      description: 'Store not found',
    },
    429: Common429Response,
  },
});

app.openapi(getStoreRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const organizationId = await ensureOrgMember(userId, orgId);
  const store = await storeService.getById(organizationId, storeId);
  return c.json(store, 200);
});

const disconnectStoreRoute = createRoute({
  method: 'delete',
  path: '/organizations/{orgId}/stores/{storeId}',
  tags: ['Stores'],
  summary: 'Disconnect (hard delete) a store',
  description:
    'Cascades to products, orders, settlements, and sync_logs. No soft-delete path — ' +
    'this is intentional per the design doc.',
  security: [{ bearerAuth: [] }],
  request: { params: storeIdParams },
  responses: {
    204: { description: 'Store disconnected' },
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
      description: 'Store not found',
    },
    429: Common429Response,
  },
});

app.openapi(disconnectStoreRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  // Disconnect is destructive (cascades to products, orders, settlements,
  // sync_logs) — gate on OWNER/ADMIN. Same rationale as POST /stores.
  const organizationId = await ensureOrgMember(userId, orgId, {
    allowedRoles: ['OWNER', 'ADMIN'],
  });
  await storeService.disconnect(organizationId, storeId);
  return c.body(null, 204);
});

// PR-C4 — manual webhook secret rotation. Triggers Trendyol PUT update with
// freshly-generated credentials, persists the new encrypted blob, and bumps
// webhookActiveAt. First-call (webhookId null) falls through to the register
// path so it doubles as a manual retry for a failed connect-time register.
const rotateWebhookSecretRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/stores/{storeId}/webhook/rotate-secret',
  tags: ['Stores'],
  summary: 'Rotate the Trendyol webhook Basic Auth secret',
  description:
    'Generates a new credential pair, calls Trendyol PUT /webhooks/:id (or ' +
    'POST /webhooks if the store has no subscription yet), and stores the ' +
    'AES-256-GCM encrypted blob on Store.webhookSecret. The old credentials ' +
    'are rejected immediately. OWNER/ADMIN only.',
  security: [{ bearerAuth: [] }],
  request: { params: storeIdParams },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z
            .object({
              rotatedAt: z.string().datetime().openapi({ example: '2026-05-20T12:00:00.000Z' }),
            })
            .openapi('RotateWebhookSecretResponse'),
        },
      },
      description: 'Secret rotated successfully',
      headers: RateLimitHeaders,
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    403: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Not OWNER/ADMIN of this organization',
    },
    404: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Store not found',
    },
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Platform not supported or credentials corrupted',
    },
    429: Common429Response,
  },
});

app.openapi(rotateWebhookSecretRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  // Rotation calls Trendyol on the user's behalf with stored credentials —
  // OWNER/ADMIN only, same posture as the disconnect path.
  const organizationId = await ensureOrgMember(userId, orgId, {
    allowedRoles: ['OWNER', 'ADMIN'],
  });
  const result = await storeService.rotateWebhookSecret(organizationId, storeId);
  return c.json(result, 200);
});

export default app;
