/**
 * Callback path segment for per-store order webhooks:
 * `${baseUrl}${WEBHOOK_ORDERS_PATH}${storeId}`.
 *
 * Single source of truth shared by the callback-URL BUILDER
 * (`webhook-orchestration.ts::buildWebhookCallbackUrl`) and the reconcile
 * planner's URL MATCHER (`webhook-reconcile.ts`). They are the two sides of one
 * contract — if they ever diverged, the reconciler would mark every store as
 * needing registration and re-create subscriptions each tick. Keep them bound
 * to this constant so they can never drift.
 *
 * Mirror of the receiver route `apps/api/src/routes/webhooks/trendyol-orders.routes.ts`
 * (`/webhooks/orders/{storeId}` under the OpenAPIHono `/v1` basePath).
 */
export const WEBHOOK_ORDERS_PATH = '/v1/webhooks/orders/';
