import { z } from '@hono/zod-openapi';

export const ValidationErrorDetailSchema = z
  .object({
    field: z.string().openapi({ example: 'costPrice' }),
    code: z.string().openapi({ example: 'NUMBER_TOO_SMALL' }),
    meta: z
      .record(z.string(), z.unknown())
      .optional()
      .openapi({ example: { min: 0 } }),
  })
  .openapi('ValidationErrorDetail');

export const ProblemDetailsMetaSchema = z
  .object({
    requestId: z.string().openapi({
      example: '3d2c3b1a-5a7d-4f62-b1a0-1e5a9b6a1234',
      description:
        'Server-side correlation id for this request. Echoed in the `X-Request-Id` response header. Quote this id in support tickets so ops can find the matching log line.',
    }),
  })
  .openapi('ProblemDetailsMeta');

export const ProblemDetailsSchema = z
  .object({
    type: z.string().url().openapi({
      example: 'https://api.pazarsync.com/errors/order-not-found',
      description: 'URI identifying the error category',
    }),
    title: z.string().openapi({ example: 'Order Not Found' }),
    status: z.number().int().openapi({ example: 404 }),
    code: z.string().openapi({
      example: 'ORDER_NOT_FOUND',
      description: 'Stable machine-readable error code (SCREAMING_SNAKE_CASE)',
    }),
    detail: z.string().openapi({ example: 'Order abc-uuid not found in store xyz-uuid' }),
    errors: z.array(ValidationErrorDetailSchema).optional(),
    meta: ProblemDetailsMetaSchema.optional(),
  })
  .openapi('ProblemDetails');
