/**
 * Policy for the error-code drift audit.
 *
 * The audit collects every RFC 7807 / domain error code that the API can
 * return, every code the frontend toast pipeline knows about, and every
 * translation key under `common.errors.*` in both `tr.json` and `en.json`.
 * Most mismatches between these sets are bugs — but a small set of codes
 * are *intentionally* absent from one or another list. Those exceptions
 * live here.
 *
 * Tune strictness by editing this file. The runner does not change.
 */

/**
 * Codes intentionally absent from `KNOWN_CODES` in the QueryProvider.
 * The global `onError` toast pipeline is silenced for these because a
 * different UI surface handles the error:
 *
 * - `UNAUTHENTICATED`: SessionExpiredHandler dispatches sign-out + toast
 *   + redirect. A second generic toast on top would be redundant.
 * - `VALIDATION_ERROR`: forms render field-level inline errors via
 *   `form.setError`. A toast on the same submit would compete with
 *   the inline error and obscure which field is wrong.
 *
 * The audit accepts these as legitimately absent from `KNOWN_CODES`.
 */
export const SILENT_CODES: ReadonlySet<string> = new Set(['UNAUTHENTICATED', 'VALIDATION_ERROR']);

/**
 * Keys under `common.errors.*` that don't correspond to a backend or
 * client-emitted error code. The audit accepts these as legitimately
 * present in translations without a matching emit site.
 *
 * - `generic`: the toast fallback used when an unknown code is received
 *   (see QueryProvider's `surfaceError` fallthrough).
 */
export const I18N_SPECIALS: ReadonlySet<string> = new Set(['generic']);
