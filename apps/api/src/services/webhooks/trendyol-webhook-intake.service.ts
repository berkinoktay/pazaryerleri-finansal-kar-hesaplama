/**
 * Thin adapter over `@pazarsync/webhook-ingest`.
 *
 * The Trendyol webhook processing pipeline moved to the shared leaf package so
 * the receiver route (here) and the future worker consumer tick share ONE
 * implementation. This file preserves the route's import path — no behaviour
 * change; the route keeps calling `processTrendyolWebhookEvent` with the default
 * ('eager') catalog-repair mode.
 */

export {
  processTrendyolWebhookEvent,
  type ProcessTrendyolWebhookEventOptions,
} from '@pazarsync/webhook-ingest';
