import { z } from '@hono/zod-openapi';

// Reusable Zod factories for Advanced Filtering query params (PR-B2). Pairing
// these with the where-builders in `where-builders.ts` keeps "add a new filter"
// down to three small, predictable edits: one param here-style line in the
// validator, one where-line in the service, one isolation test.
//
// Multi-value params use a COMMA-SEPARATED string (e.g. ?statusIn=A,B) rather
// than repeated keys: the codebase has no array query params yet, and a single
// string round-trips cleanly through the typed openapi-fetch client without
// relying on repeated-key array coercion.

// Comma-separated multi-value param, each item validated by `itemSchema`. One
// helper serves every multi-select: enums (`z.enum(FooConst)`), BigInt ids
// (`z.coerce.bigint()`), and fixed ints (`z.coerce.number().int()`). Output is
// the parsed item array (or undefined when omitted). Blank entries are dropped;
// an all-blank value fails `.min(1)` so a stray `?fooIn=` is a 422, not a silent
// match-nothing.
export function csvParam<O>(
  itemSchema: z.ZodType<O>,
  meta: { description: string; example: string },
): z.ZodType<O[] | undefined, unknown> {
  // Split in a preprocess (unknown → string[]) rather than transform().pipe():
  // coercing item schemas (z.coerce.bigint/number) take `unknown` input, which
  // a piped `z.array(...)` won't statically accept after a string transform.
  return z
    .preprocess(
      (val) =>
        typeof val === 'string'
          ? val
              .split(',')
              .map((v) => v.trim())
              .filter((v) => v.length > 0)
          : val,
      z.array(itemSchema).min(1),
    )
    .optional()
    .openapi({ type: 'string', ...meta });
}

// A single decimal-string bound for a money/number range param (e.g. saleMin).
// `allowNegative` for profit columns where a loss is a valid lower bound. The
// service converts the string to Decimal only when present. Reuses the
// codebase's 2-dp decimal-string regex (cost-profile.validator.ts:37).
export function decimalBoundParam(
  meta: { description: string; example: string },
  opts?: { allowNegative?: boolean },
): z.ZodType<string | undefined, string | undefined> {
  const re = opts?.allowNegative === true ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/;
  return z.string().trim().regex(re, 'INVALID_DECIMAL_FORMAT').optional().openapi(meta);
}

// A single non-negative integer bound for a count range param (e.g. stockMin).
// Input is `unknown` because z.coerce accepts the raw query value before
// coercion (mirrors TablePaginationQuerySchema's page/perPage).
export function intBoundParam(meta: {
  description: string;
  example: number;
}): z.ZodType<number | undefined, unknown> {
  return z.coerce.number().int().min(0).optional().openapi(meta);
}

// Single-tap boolean flag. Present+true → the filter applies; absent (or the
// rarely-sent false) → no filter, matching the chip UI's single-tap toggle.
export function flagParam(meta: {
  description: string;
}): z.ZodType<boolean | undefined, string | undefined> {
  return z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
    .openapi({ type: 'boolean', example: true, ...meta });
}
