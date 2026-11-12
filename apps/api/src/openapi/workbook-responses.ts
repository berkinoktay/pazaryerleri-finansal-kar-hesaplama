import { z } from '@hono/zod-openapi';

import { ProblemDetailsSchema } from './error-schemas';

/**
 * Error responses shared by every workbook import route, raised by the
 * pre-body upload guard (413, 415) and by the import transaction (503).
 * Spread into a route's `responses` next to its own status codes.
 */
export const WORKBOOK_IMPORT_ERROR_RESPONSES = {
  413: {
    content: { 'application/json': { schema: ProblemDetailsSchema } },
    description: 'Request body exceeds the upload size limit (PAYLOAD_TOO_LARGE)',
  },
  415: {
    content: { 'application/json': { schema: ProblemDetailsSchema } },
    description: 'Request body is not multipart/form-data (UNSUPPORTED_MEDIA_TYPE)',
  },
  503: {
    content: { 'application/json': { schema: ProblemDetailsSchema } },
    description: 'The server is too busy to run the import right now (IMPORT_BUSY)',
    headers: z.object({
      'Retry-After': z.number().int().openapi({ description: 'Seconds to wait before retrying' }),
    }),
  },
};

/**
 * Error responses shared by every workbook export route: the stored workbook is
 * re-read through the same per-process parse queue, which answers 503 when full.
 */
export const WORKBOOK_EXPORT_ERROR_RESPONSES = {
  503: {
    content: { 'application/json': { schema: ProblemDetailsSchema } },
    description: 'The server is too busy to read the stored workbook right now (IMPORT_BUSY)',
    headers: z.object({
      'Retry-After': z.number().int().openapi({ description: 'Seconds to wait before retrying' }),
    }),
  },
};
