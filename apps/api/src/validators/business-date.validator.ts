// The `from`/`to` business-date query params of the orders and returns endpoints. A value
// is a date-only `YYYY-MM-DD` naming a real calendar date (anything else, a time of day
// included, is INVALID_BUSINESS_DATE) inside BUSINESS_DATE_PARAM_MIN..BUSINESS_DATE_PARAM_MAX
// (outside it, BUSINESS_DATE_OUT_OF_RANGE). The service reads it as a whole Istanbul
// business day (businessDateRangeFilter).

import { z } from '@hono/zod-openapi';

import {
  BUSINESS_DATE_OUT_OF_RANGE,
  BUSINESS_DATE_PARAM_MAX,
  BUSINESS_DATE_PARAM_MIN,
} from '../lib/business-date-range';

/** An optional business-date query param (`YYYY-MM-DD`, OpenAPI format `date`). */
export function businessDateQueryParam(
  description: string,
  example: string,
): z.ZodOptional<z.ZodISODate> {
  return (
    // `abort` stops at a malformed value, so it reports INVALID_BUSINESS_DATE alone instead
    // of also running the range check on a string that is not a date.
    z.iso
      .date({ error: 'INVALID_BUSINESS_DATE', abort: true })
      // Both bounds are YYYY-MM-DD, so string comparison is date order.
      .refine((value) => value >= BUSINESS_DATE_PARAM_MIN && value <= BUSINESS_DATE_PARAM_MAX, {
        error: BUSINESS_DATE_OUT_OF_RANGE,
      })
      .optional()
      .openapi({ description, example })
  );
}
