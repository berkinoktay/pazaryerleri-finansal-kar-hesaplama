import { ApiError } from '@/lib/api-error';

/**
 * The field codes the tariff selection routes answer when a selection can not be
 * exported:
 *   - commission tariff: a band the item does not hold (`BAND_NOT_STORED`), or a band
 *     with no price and no custom price (`BAND_PRICE_UNKNOWN`);
 *   - Plus commission tariff: a join with no custom price on an offer whose Plus price
 *     upper limit is unknown (`PLUS_PRICE_UNKNOWN`), or any join (also with a custom
 *     price) on an offer whose Plus commission percent is unknown
 *     (`PLUS_COMMISSION_UNKNOWN`).
 */
const REFUSED_SELECTION_CODES: ReadonlySet<string> = new Set([
  'BAND_NOT_STORED',
  'BAND_PRICE_UNKNOWN',
  'PLUS_PRICE_UNKNOWN',
  'PLUS_COMMISSION_UNKNOWN',
]);

/** Which toast a failed selection save shows, if any. */
export type SelectionSaveErrorToast = 'selectionRefused' | 'generic';

/**
 * Picks the toast for a failed tariff selection save (commission and Plus pages).
 *
 * The global error pipeline keeps `VALIDATION_ERROR` silent (forms show it inline), and
 * the detail pages have no form for the selections, so the page has to say something:
 *   - `'selectionRefused'` when the route refused a selection it can not export (a code
 *     from {@link REFUSED_SELECTION_CODES}): the seller reloads and chooses again;
 *   - `'generic'` for any other validation issue (the selection count limit, an invalid
 *     custom price), which the seller could not cause from the page.
 * Every other error is already toasted by the global pipeline, so it returns `null`.
 */
export function selectionSaveErrorToast(error: unknown): SelectionSaveErrorToast | null {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR') return null;
  const issues = error.problem.errors ?? [];
  return issues.some((issue) => REFUSED_SELECTION_CODES.has(issue.code))
    ? 'selectionRefused'
    : 'generic';
}
