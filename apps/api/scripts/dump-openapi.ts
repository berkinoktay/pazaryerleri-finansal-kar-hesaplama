import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

import { bearerAuthScheme } from "../src/openapi";

// NOTE: This script must mirror the spec configuration in apps/api/src/index.ts.
// We construct a minimal OpenAPIHono just to call getOpenAPI31Document and write
// the result. Importing src/index.ts directly would trigger serve() and start
// the HTTP server — undesirable for a build-time script.
//
// As routes are added to apps/api/src/routes/, they must be re-mounted here too.
//
// FUTURE: refactor index.ts to export the configured app (via a createApp()
// factory without side effects) so this script can import it directly. Deferred
// until we have ≥3 routes per the plan's "Open Items" section.

const app = new OpenAPIHono().basePath("/v1");

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", bearerAuthScheme);

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  summary: "Health check",
  description: "Returns 200 when the service is up.",
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

const spec = app.getOpenAPI31Document({
  openapi: "3.1.0",
  info: {
    title: "PazarSync API",
    version: "1.0.0",
    description: "Internal REST API.",
  },
  servers: [
    { url: "http://localhost:3001", description: "Local dev" },
    { url: "https://staging-api.pazarsync.com", description: "Staging" },
  ],
  security: [{ bearerAuth: [] }],
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "../../../packages/api-client/openapi.json");

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(spec, null, 2) + "\n", "utf-8");

console.log(`✓ Wrote OpenAPI 3.1 spec to ${outPath}`);
