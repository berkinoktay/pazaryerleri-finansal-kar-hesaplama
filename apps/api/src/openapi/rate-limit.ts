import { z } from "@hono/zod-openapi";
import { ProblemDetailsSchema } from "./error-schemas";

/**
 * Standard rate-limit response headers attached to every successful response
 * on a protected endpoint. Values are set by the rate-limit middleware.
 */
export const RateLimitHeaders = {
  "X-RateLimit-Limit": {
    schema: z.number().int(),
    description: "Maximum requests permitted in the current window",
  },
  "X-RateLimit-Remaining": {
    schema: z.number().int(),
    description: "Requests remaining in the current window",
  },
  "X-RateLimit-Reset": {
    schema: z.number().int(),
    description: "Epoch seconds when the current window resets",
  },
} as const;

/**
 * Shared 429 response definition. Every protected endpoint inherits this in
 * its `responses[429]` block.
 */
export const Common429Response = {
  description: "Rate limit exceeded",
  headers: {
    "Retry-After": {
      schema: z.number().int(),
      description: "Seconds to wait before retrying",
    },
  },
  content: {
    "application/json": { schema: ProblemDetailsSchema },
  },
} as const;
