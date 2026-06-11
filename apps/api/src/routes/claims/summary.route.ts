import { createRoute, z } from '@hono/zod-openapi';

import { createSubApp } from '../../lib/create-hono-app';
import { requireStoreAccess } from '../../lib/require-store-access';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import * as claimService from '../../services/claim.service';
import {
  ClaimsSummaryResponseSchema,
  claimsSummaryQuerySchema,
} from '../../validators/claim.validator';

const app = createSubApp<{ Variables: { userId: string } }>();

const storeScopeParams = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  storeId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'storeId', in: 'path' } }),
});

const claimsSummaryRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/stores/{storeId}/claims/summary',
  tags: ['Claims'],
  summary: 'Return-claims KPI summary for a store',
  description:
    'KPI strip data for the returns page: current open-claim count, resolved count in the ' +
    'period, and the financial totals of the return trio (REFUND_DEDUCTION / ' +
    'COMMISSION_REFUND / COST_RETURN) captured in the period. Count KPIs use claimDate; ' +
    'financial KPIs use OrderFee.capturedAt. Period defaults to the last 30 days.',
  security: [{ bearerAuth: [] }],
  request: {
    params: storeScopeParams,
    query: claimsSummaryQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ClaimsSummaryResponseSchema } },
      description: 'Returns KPI summary',
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
    422: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Invalid query params',
    },
    429: Common429Response,
  },
});

app.openapi(claimsSummaryRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const range = c.req.valid('query');
  await requireStoreAccess(userId, orgId, storeId);

  const summary = await claimService.getClaimsSummary(orgId, storeId, range);
  return c.json(summary, 200);
});

export default app;
