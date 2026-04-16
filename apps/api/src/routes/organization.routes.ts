import { OpenAPIHono, createRoute } from "@hono/zod-openapi";

import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from "../openapi";
import { OrganizationListResponseSchema } from "../validators/organization.validator";

const app = new OpenAPIHono();

const listOrganizationsRoute = createRoute({
  method: "get",
  path: "/organizations",
  tags: ["Organizations"],
  summary: "List organizations the authenticated user is a member of",
  description:
    "Returns all organizations where the authenticated user has an OrganizationMember record. " +
    "Not paginated — typical users belong to fewer than 10 organizations.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      content: { "application/json": { schema: OrganizationListResponseSchema } },
      description: "List of organizations",
      headers: RateLimitHeaders,
    },
    401: {
      content: { "application/json": { schema: ProblemDetailsSchema } },
      description: "Missing or invalid auth token",
    },
    429: Common429Response,
  },
});

app.openapi(listOrganizationsRoute, (c) => {
  // TODO: Replace with prisma.organization.findMany filtered by authenticated user's
  // organization_members. Auth middleware must be in place first (separate plan).
  return c.json(
    {
      data: [
        {
          id: "00000000-0000-0000-0000-000000000000",
          name: "Akyıldız Store",
          slug: "akyildiz-store",
          createdAt: "2026-01-15T10:30:00Z",
          updatedAt: "2026-04-01T14:00:00Z",
        },
      ],
    },
    200,
  );
});

export default app;
