# @pazarsync/order-sync

Idempotent order upsert: maps a marketplace payload to a domain `Order` and
writes it without creating duplicates on re-sync.

## Idempotency

Re-running a sync over the same window must not double-write. Dedup is by the
composite unique constraint on the marketplace order identity — an upsert, not a
blind insert. `intake-order` maps and validates the payload; `upsert-order`
performs the write.

## Money

Order amounts are `Decimal` end to end (see `@pazarsync/profit` and the root
`CLAUDE.md`). Never coerce a money value to a JS `number`.
