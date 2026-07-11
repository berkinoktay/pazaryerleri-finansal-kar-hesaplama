/**
 * Thin adapter over `@pazarsync/webhook-ingest`.
 *
 * The Trendyol webhook processing pipeline moved to the shared leaf package so
 * the receiver route (here) and the worker consumer tick share ONE
 * implementation. This file preserves the route's import path — no behaviour
 * change; the route calls `processTrendyolWebhookEvent` with `catalogRepair:
 * 'deferred'` (D5 — zero vendor calls in the request path).
 */

export {
  processTrendyolWebhookEvent,
  type ProcessTrendyolWebhookEventOptions,
} from '@pazarsync/webhook-ingest';
