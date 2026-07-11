# @pazarsync/webhook-ingest

Shared processing pipeline for a persisted marketplace webhook event. Given a
`WebhookEvent` row, it maps the payload to a domain order and dispatches intake:
status mapping, fee resolution, payload mapping, catalog repair, `intakeOrder`,
the `processedAt`/`processingError` lifecycle, and the RETURNED -> CLAIMS
acceleration.

Extracted from `apps/api` so both the receiver route and the (future) worker
consumer tick share ONE implementation. This is a leaf package — nothing depends
on it, so it cannot introduce a workspace cycle.

## Catalog repair mode

`processTrendyolWebhookEvent` accepts `catalogRepair: 'eager' | 'deferred'`
(default `'eager'`). `'deferred'` skips the in-request `ensureBarcodesInCatalog`
call so the request never blocks on a live vendor lookup; the 60s
variant-resolution tick is the backstop (order-line variant recovery epic).
