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
