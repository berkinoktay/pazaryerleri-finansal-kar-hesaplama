import { describe, it, expect } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";

import organizationRoutes from "../../src/routes/organization.routes";

describe("GET /v1/organizations", () => {
  const app = new OpenAPIHono().basePath("/v1");
  app.route("/", organizationRoutes);

  it("returns 200 with a data array of organizations", async () => {
    const res = await app.request("/v1/organizations");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      slug: expect.any(String),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });
});
