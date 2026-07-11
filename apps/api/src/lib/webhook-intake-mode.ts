/**
 * Cutover flag for the Trendyol webhook receiver (design 2026-07-11 Paket D,
 * section D6). When `WEBHOOK_INTAKE_DEFERRED` is exactly the literal string
 * 'true', the route only validates + persists the event and returns 200,
 * leaving ALL processing to the sync-worker consumer tick (Live Performance
 * latency shifts from T+0 to T+~5s). Anything else keeps today's in-request
 * processing — a fail-safe default, so an unset/typo'd value never silently
 * stops orders from being processed.
 *
 * Read LAZILY per request (mirrors the ALLOW_SANDBOX_CONNECTIONS literal-'true'
 * check in `services/store.service.ts`) so a deploy can flip the flag with a
 * restart and tests can stub it per-case. Being request-time, it does NOT
 * belong in `validateRequiredEnv()`.
 */
export function isWebhookIntakeDeferred(): boolean {
  return process.env['WEBHOOK_INTAKE_DEFERRED'] === 'true';
}
