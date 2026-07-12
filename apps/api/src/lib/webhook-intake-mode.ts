/**
 * Emergency escape hatch for the Trendyol webhook receiver (design 2026-07-11
 * Paket D, section D6; permanent cutover recorded in issue #460).
 *
 * DEFERRED intake is now the DEFAULT: the route only validates + persists the
 * event and returns 200, leaving ALL processing to the sync-worker consumer tick
 * (a live cutover rehearsal measured the consumer draining a fresh row in ~1s).
 *
 * When `WEBHOOK_INTAKE_INLINE` is exactly the literal string 'true', the route
 * temporarily restores in-request processing. This exists ONLY as an emergency
 * escape hatch — if the sync-worker cannot be brought back up for a long stretch,
 * flipping this keeps webhook orders flowing from the API process itself. It
 * stays OFF in normal operation; an unset or typo'd value keeps the fail-safe
 * default (deferred), so a misconfiguration can never silently re-attach
 * processing work to the request path.
 *
 * Read LAZILY per request (mirrors the ALLOW_SANDBOX_CONNECTIONS literal-'true'
 * check in `services/store.service.ts`) so a deploy can flip the flag with a
 * restart and tests can stub it per-case. Being request-time, it does NOT
 * belong in `validateRequiredEnv()`.
 */
export function isWebhookIntakeInline(): boolean {
  return process.env['WEBHOOK_INTAKE_INLINE'] === 'true';
}
