import { z } from '@hono/zod-openapi';

import { ProblemDetailsSchema } from './error-schemas';

/**
 * Standard rate-limit response headers attached to every successful response
 * on a protected endpoint. Values are set by the rate-limit middleware.
 *
 * Shape is an AnyZodObject so it can be passed directly to a route's
 * `responses[200].headers`.
 */
export const RateLimitHeaders = z.object({
  'X-RateLimit-Limit': z
    .number()
    .int()
    .openapi({ description: 'Maximum requests permitted in the current window' }),
  'X-RateLimit-Remaining': z
    .number()
    .int()
    .openapi({ description: 'Requests remaining in the current window' }),
  'X-RateLimit-Reset': z
    .number()
    .int()
    .openapi({ description: 'Epoch seconds when the current window resets' }),
});

/**
 * Shared 429 response definition. Every protected endpoint inherits this in
 * its `responses[429]` block.
 */
export const Common429Response = {
  description: 'Rate limit exceeded',
  headers: z.object({
    'Retry-After': z.number().int().openapi({ description: 'Seconds to wait before retrying' }),
  }),
  content: {
    'application/json': { schema: ProblemDetailsSchema },
  },
};
