import { parseAsString } from 'nuqs';

/**
 * URL state for the Product Commission Tariffs page. `week` and `period` are
 * opaque ids resolved against the data at render time (falling back to the
 * first available) — there is deliberately no fixed period enum, because the
 * tariff structure is data-driven. `q` is the product search term.
 */
export const commissionTariffFiltersParsers = {
  week: parseAsString.withDefault(''),
  period: parseAsString.withDefault(''),
  q: parseAsString.withDefault(''),
};
