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
