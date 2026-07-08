-- Set ONCE when the buffer-promote worker graduates a cost-missing buffer entry into
-- this orders row. Consumed by the live-performance notification summary so the frontend
-- can distinguish a promotion INSERT (an order the merchant already saw hours ago) from a
-- genuinely new order and suppress the duplicate "new order" toast. Null for orders
-- written directly by the webhook receiver or polling sync.
--
-- Additive, nullable, no default, no index, no constraint. Legacy rows, webhook-receiver
-- and polling-sync inserts stay NULL. Pure ADD COLUMN: no INSERT-path behavior change.
-- orders already has org-scoped RLS; this row-agnostic column needs no policy change.

ALTER TABLE "orders" ADD COLUMN "promoted_from_buffer_at" TIMESTAMP(3);
