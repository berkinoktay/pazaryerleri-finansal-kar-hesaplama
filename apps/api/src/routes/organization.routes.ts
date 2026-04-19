import { OpenAPIHono, createRoute } from '@hono/zod-openapi';

import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../openapi';
import * as organizationService from '../services/organization.service';
import { OrganizationListResponseSchema } from '../validators/organization.validator';

const app = new OpenAPIHono<{ Variables: { userId: string } }>();

const listOrganizationsRoute = createRoute({
  method: 'get',
  path: '/organizations',
  tags: ['Organizations'],
  summary: 'List organizations the authenticated user is a member of',
  description:
    'Returns all organizations where the authenticated user has an OrganizationMember record, ' +
    'ordered by name ascending. Not paginated — typical users belong to fewer than 10 organizations.',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      content: { 'application/json': { schema: OrganizationListResponseSchema } },
      description: 'List of organizations',
      headers: RateLimitHeaders,
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    429: Common429Response,
  },
});

app.openapi(listOrganizationsRoute, async (c) => {
  const userId = c.get('userId');
  const data = await organizationService.listForUser(userId);
  return c.json({ data }, 200);
});

export default app;
