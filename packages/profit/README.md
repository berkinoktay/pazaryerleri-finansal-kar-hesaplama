# @pazarsync/profit

The profit engine: turns an order plus its costs into real profitability — the
question a marketplace dashboard can't answer ("how much did I actually make?").

## The one rule: decimal.js end to end

Every monetary value is a `Decimal`, never a JS `number`. A single `Number(x)`,
`parseFloat`, `.toNumber()`, or unary `+` on a money field silently reintroduces
floating-point error and breaks the product's core promise. This is enforced by
`scripts/audit-money.ts` (wired into `check:all`) — don't work around it.

## Estimates are optimistic; settlement reconciles

`estimate-on-order-create` computes a **best-case** profit at order time (the
successful commission tier, nominal cargo). It is intentionally optimistic —
failed tiers and real fees aren't known yet. `recompute-settled-profit` later
replaces the estimate with the **actual** values from the marketplace settlement
invoice. Never treat an on-create estimate as final.

## Shape

Pure functions — no I/O, no DB, unit-testable in isolation. `profit-formula` is
the core; the `resolve-*` / `infer-*` helpers feed it. Marketplace parameters
(commission baremler, desi limits, fee thresholds) live in DB rows, never baked
into code or enum names.

See the root `CLAUDE.md` for the shared money/decimal standards.

## Profit line core (rebuild, phase 1)

A marketplace-agnostic rebuild of the profit computation lives alongside the legacy
`computeProfit`, not yet wired into any caller. It is organized in two pure folders:

- `core/` holds the line model (`createProfitLine`, the `PROFIT_LINE_CATALOG` line-type
  catalog, the single `selectLines` rule, per-item allocation of parcel-level lines,
  event-date FX selection and conversion, the issue catalog and status, and the
  `computeProfitStatement` statement that ties them together).
- `tax/tr/` holds the Turkish tax module: VAT from a gross amount, the stoppage base
  and amount, and the output/input/net VAT totals (`computeVatTotals`,
  `effectiveNetVat`).

The design is documented in `docs/plans/2026-10-29-profit-engine-design.md` (local to
the repo; `docs/` is gitignored). An equivalence test proves the new core reproduces
the legacy formula to the kurus across all twelve legacy scenarios, and a golden test
pins the real melontik order 11761487239.

## Trendyol module and seller costs (rebuild, phase 2A)

The second rebuild phase adds the Trendyol-specific estimators and the settlement
mapper, still marketplace-agnostic at the core. A `ParcelSnapshot` (one parcel, its
items and accounting currency) is the shared input that every estimator reads;
`core/seller-costs/` turns the seller's cost profiles into cost and cost-return lines.
`estimateTrendyolParcel` composes the estimators in a fixed order — sale, commission,
seller costs, stoppage, service fee, shipping, international service fee, then the
return legs — and returns the lines, the issues, and the active/returned item sets.
`mapTrendyolRecords` reconciles real settlement and cargo-invoice records into actual
lines and confirms the estimates through two independent payment cycles (the sale
cycle and the return cycle), each gated on its own payment order. The catalog's
`allocationScope` decides whether a parcel-level line is split across the active items
or the returned items. Nothing calls this module yet; phase 3 wires the database
loader and the callers to it. A second golden test pins the melontik parcel end to end
through the module, including the ESTIMATED -> PARTIALLY_SETTLED -> SETTLED transition.

## Scenario and price solver (rebuild, phase 2B)

A product scenario is a hypothetical one-item parcel pushed through the same Trendyol
module and profit statement as a real order, so the Barem band and the commission band
follow the asked price and each cost's VAT comes from its own profile rate -- there is
no scenario-specific formula. On top of it a marketplace-agnostic solver finds the
lowest unit price that meets a target margin, markup or net profit: it splits the price
axis at the marketplace's breakpoints and at the net VAT kink, solves each segment in
closed form from two samples, and resolves the candidate with a bounded noise-aware
kurus scan -- no binary search. The audit report's worked examples are pinned as golden
tests.
Nothing calls this yet; phase 4 wires the pricing and campaign screens to it.

## Persistence (rebuild, phase 3A)

`persistence/` writes a parcel's computed profit to four tables:

- `profit_lines` -- one row per profit line (sale, commission, shipping, cost, ...),
  at item or parcel level, with its money, VAT, original currency and fx conversion.
- `profit_line_allocations` -- one row per item share of a parcel-level line, so both
  statement views can be summed per item.
- `order_profit_statements` -- one rolled-up statement per parcel per view (`ESTIMATE`
  and `BEST_KNOWN`): sale/cost/VAT/stoppage totals, status, net profit and margins,
  the resolved settings snapshot and a content hash.
- `marketplace_finance_records` -- the raw settlement, other-financial and cargo-invoice
  rows the loader reads; the writer does not change them. Period records (ads, period
  stoppage, deduction invoices) are stored raw as well -- turning them into period expenses
  is a later epic, not this phase.

`recomputeParcelProfit(tx, { organizationId, orderId })` runs inside the caller's
transaction. It first takes a per-order advisory lock, so two concurrent recomputes of
the same order run one at a time. It loads the parcel, drives it through the pure
estimate + settlement mapper, builds both statement views and the per-item allocations,
and hashes everything it would persist. When the stored content hash already matches,
it is a no-op (`changed: false`); otherwise it deletes the parcel's lines (allocations
cascade) and rewrites the lines, allocations and both statement rows. Every row carries
the order's `organizationId` and `storeId`. The caller's transaction must run at READ
COMMITTED (Postgres' default) so a call that waited on the lock sees the committed
statements of the call that held it, and must set an interactive-transaction timeout
long enough for a lock wait plus the load (Prisma's 5s default may be too short).

`loadTrendyolParcel` reads only, filtering every store-scoped table by the order's store
and every org-scoped table by the order's organization; an order that is not the given
organization's raises `ParcelNotFoundError`.

## Recompute queue (phase 3B)

`persistence/recompute-queue.ts` is the single path that keeps statements current. Every
producer -- the order write, the variant-resolution link, a claim upsert, a raw finance
record ingest, and the cost / settings / shipping / desi / tariff / catalog input changes
-- enqueues one per-order mark inside its own transaction (`enqueueProfitRecompute` and
its scope variants). The mark write is atomic with the event that caused it, and a failed
recompute never rolls that event back.

The sync-worker drains the queue on a tick (`apps/sync-worker/src/handlers/profit-recompute.ts`),
every 5 seconds: it claims a batch with `FOR UPDATE SKIP LOCKED` and recomputes each order
in its own short transaction. When the queue is empty the tick sweeps a batch of stale
orders -- those with no best-known statement, or one stamped by an older engine version --
into the queue (`enqueueStaleProfitStatements`), so a new engine version and the phase 3D
backfill migrate themselves. The sweep is a full `orders` scan, so it is throttled: it runs
at most once every 5 minutes, but immediately on the next tick while it is still finding
work (catch-up).

To re-run a whole store on demand -- after a reference-data correction, or for the phase 3D
backfill -- use the operator script:

    cd packages/profit && pnpm exec tsx --env-file=../../.env scripts/enqueue-profit-recompute.ts --store <id>
    cd packages/profit && pnpm exec tsx --env-file=../../.env scripts/enqueue-profit-recompute.ts --all

`--all` enqueues every ACTIVE store. The marks are drained by the same tick.
