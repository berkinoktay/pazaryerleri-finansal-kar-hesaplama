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
  })
  .openapi('ProblemDetails');
