import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono().basePath("/v1");

app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));

export default {
  port: Number(process.env["PORT"]) || 3001,
  fetch: app.fetch,
};
