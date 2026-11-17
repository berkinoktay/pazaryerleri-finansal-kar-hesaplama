import { ApiError } from '@/lib/api-error';

/**
 * The field codes the commission tariff selection route answers when a selection can
 * not be exported: a band the item does not hold (`BAND_NOT_STORED`), or a band with no
 * price and no custom price (`BAND_PRICE_UNKNOWN`).
 */
const REFUSED_SELECTION_CODES: ReadonlySet<string> = new Set([
  'BAND_NOT_STORED',
  'BAND_PRICE_UNKNOWN',
]);

/** Which toast a failed selection save shows, if any. */
export type SelectionSaveErrorToast = 'selectionRefused' | 'generic';

/**
 * Picks the toast for a failed commission tariff selection save.
 *
 * The global error pipeline keeps `VALIDATION_ERROR` silent (forms show it inline), and
 * the detail page has no form for the selections, so this page has to say something:
 *   - `'selectionRefused'` when the route refused a selection it can not export (a band
 *     code from {@link REFUSED_SELECTION_CODES}): the seller reloads and chooses again;
 *   - `'generic'` for any other validation issue (the selection count limit, an invalid
 *     custom price), which the seller could not cause from this page.
 * Every other error is already toasted by the global pipeline, so it returns `null`.
 */
export function selectionSaveErrorToast(error: unknown): SelectionSaveErrorToast | null {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR') return null;
  const issues = error.problem.errors ?? [];
  return issues.some((issue) => REFUSED_SELECTION_CODES.has(issue.code))
    ? 'selectionRefused'
    : 'generic';
}
