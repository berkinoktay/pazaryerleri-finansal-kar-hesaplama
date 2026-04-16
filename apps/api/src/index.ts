import { serve } from "@hono/node-server";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { bearerAuthScheme } from "./openapi";
import organizationRoutes from "./routes/organization.routes";

const app = new OpenAPIHono().basePath("/v1");

app.use("*", logger());
app.use("*", cors());

// Register the bearerAuth security scheme on the document.
app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", bearerAuthScheme);

// Health check — public, unauthenticated, used by load balancers.
const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  summary: "Health check",
  description: "Returns 200 when the service is up. Public endpoint, no auth required.",
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ status: z.literal("ok") }).openapi("HealthResponse") },
      },
      description: "Service is healthy",
    },
  },
});

app.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));

// Feature routes.
app.route("/", organizationRoutes);

// Spec + docs UI — DEV/STAGING ONLY. Production has no public surface here.
if (process.env["NODE_ENV"] !== "production") {
  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "PazarSync API",
      version: "1.0.0",
      description:
        "Internal REST API. See `docs/plans/2026-04-16-api-docs-design.md` for conventions.",
    },
    servers: [
      { url: "http://localhost:3001", description: "Local dev" },
      { url: "https://staging-api.pazarsync.com", description: "Staging" },
    ],
    security: [{ bearerAuth: [] }],
  });

  app.get(
    "/docs",
    Scalar({
      url: "/v1/openapi.json",
      pageTitle: "PazarSync API Reference",
    }),
  );
}

const port = Number(process.env["PORT"]) || 3001;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`PazarSync API listening on http://localhost:${info.port}`);
});

export default app;
