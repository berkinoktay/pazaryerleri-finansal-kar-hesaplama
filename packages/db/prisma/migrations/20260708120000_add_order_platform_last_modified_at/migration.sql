-- Marketplace-side lastModifiedDate of the most recent event / sync page applied to
-- this order row. The order upsert uses it as an out-of-order guard: a stale webhook
-- re-delivery or a racing hourly-sync page must never regress status/fields already
-- written by a newer event.
--
-- Additive, nullable, no default, no index, no constraint. Legacy rows and buffer-JSONB
-- replays without the field stay NULL and skip the guard. Pure ADD COLUMN: no INSERT-path
-- behavior change. orders already has org-scoped RLS; this row-agnostic column needs no
-- policy change.

ALTER TABLE "orders" ADD COLUMN "platform_last_modified_at" TIMESTAMP(3);
