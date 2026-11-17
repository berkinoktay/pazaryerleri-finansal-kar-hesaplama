// The custom price a tariff selection may carry, shared by the tariff selection bodies so
// every page reads and refuses a custom price the same way.

import { z } from '@hono/zod-openapi';

import { PROBE_INTEGER_DIGITS } from '../config/workbook-limits';

// A custom price that is zero at two decimals (`0`, `0.0`, `0.00`, `000`). Zero is not a
// real price: stored, it would pass the BAND_PRICE_UNKNOWN check of a band with no price
// and the export would write 0.00. Matched as text, not parsed: Zod still runs the refine
// after a failed regex, so the predicate must not throw on a malformed string (that one
// is left to the regex, which already reports it).
const ZERO_PRICE_PATTERN = /^0+(\.0{1,2})?$/;

// At most PROBE_INTEGER_DIGITS integer digits and two decimals: what the stored
// custom_price column (numeric(12,2)) holds and what the export's price columns accept.
// A wider value would overflow the column on save (a 500) instead of a 422.
const CUSTOM_PRICE_PATTERN = new RegExp(
  `^\\d{1,${PROBE_INTEGER_DIGITS.toString()}}(\\.\\d{1,2})?$`,
);

/** A positive decimal price with at most two decimals; a zero price is refused. */
export const SelectionCustomPriceSchema = z
  .string()
  .regex(CUSTOM_PRICE_PATTERN, 'INVALID_CUSTOM_PRICE')
  .refine((value) => !ZERO_PRICE_PATTERN.test(value), 'INVALID_CUSTOM_PRICE');
