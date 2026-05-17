# Shipping Cost Estimation — V2 Roadmap

**Status:** Roadmap (V1 shipped; V2 items not started)
**V1 reference:** PR [#180](https://github.com/berkinoktay/pazaryerleri-finansal-kar-hesaplama/pull/180) merged 2026-05-17 → `f0a74c3`
**V1 spec:** [`docs/superpowers/specs/2026-05-17-shipping-cost-estimation-design.md`](../superpowers/specs/2026-05-17-shipping-cost-estimation-design.md)
**V1 plan:** [`docs/superpowers/plans/2026-05-17-shipping-cost-estimation.md`](../superpowers/plans/2026-05-17-shipping-cost-estimation.md)

---

## Why This Document Exists

V1 shipped variant-level (catalog-time) shipping cost estimation. Throughout brainstorming and implementation we deliberately deferred a set of items — some because they need an upstream feature (orders integration), some because they were YAGNI for V1, some because they're polish that should follow real user feedback. This roadmap captures every deferred item so a future session (LLM or human) can pick them up without re-deriving the context.

Each item below is sized and dependency-ordered. Start at the top; later items mostly stack on earlier ones.

---

## Priority Table

| # | Item | Priority | Depends on | Rough effort | Source |
|---|------|----------|-----------|--------------|--------|
| V2.1 | **Order-level `estimatedShippingCost` snapshot** | 🔥 Highest | Orders/webhook integration feature | M (1-2 PRs) | spec §5.3, §12 |
| V2.2 | **Settlement reconciliation** (estimated vs real) | 🔥 High | V2.1 + settlement integration feature | M (1 PR) | spec §12, memory `estimates-optimistic-settlement-reconciles` |
| V2.3 | **Own contract Excel upload** | 🟡 Medium | — (backend already ready, V1 placeholder UI) | M (1 PR) | spec §2 decision 8, §12 |
| V2.4 | **Banner category filters** (clickable breakdown) | 🟢 Low | — | S (small PR) | spec §12, brainstorming session |
| V2.5 | **Live test/preview calculator** in Store settings | 🟢 Low | — | S (small PR) | spec §11 risk #7, §12 |
| V2.6 | **Tariff history/versioning** (`effective_to`) | 🟢 Low (audit) | Driven by V2.2 reconciliation audit need | M (1 PR) | spec §11 risk #4, §12 |
| V2.7 | **Hepsiburada tariff data seed** | ⏸ Blocked | Hepsiburada integration first | S (data-only PR) | spec §4.7, §12 |
| V2.8 | **`Order.netProfit` write-once DB trigger** | 🟡 Medium | V2.1 (needs Order snapshot to exist) | S | spec §8.4 |
| V2.9 | **`ShippingTariffApplied` snapshot persistence** | 🟡 Medium | V2.1 | XS (column add on Order) | spec §4.6 |
| V3+ | Admin UI for tariff CRUD | Defer | Driven by tariff change frequency | M | spec §12 |
| V3+ | Per-product carrier override | Defer | Real user pain signal | M | spec §12 |
| V3+ | `changeCargoProvider` operational integration | Defer | Different feature space | M | spec §12 |
| V3+ | Carrier logos in dropdown | Defer | Pure polish | S | spec §12 |

Legend: 🔥 ships next once dependencies land · 🟡 valuable, not urgent · 🟢 polish · ⏸ blocked by external feature · Defer = beyond V2

---

## V2.1 — Order-level `estimatedShippingCost` snapshot 🔥

**Scope:**

When a Trendyol order webhook arrives, the sync worker captures the shipping estimate as a write-once snapshot on the `Order` row. This freezes "what we estimated at the time" so settlement reconciliation (V2.2) can compare against the real value Trendyol invoices later.

**Why now (when orders ships):**

V1 currently shows estimates dynamically — every catalog page load re-runs the SQL CTE against current tariff. For Orders this is wrong: an order placed in April should remember the April tariff snapshot, even if Trendyol updates rates in May. Catalog estimates are forward-looking ("what's profit if I sell this?"); order estimates are point-in-time ("what did I expect when I sold this?"). Two different semantics, two different storage strategies.

**Concrete deliverables:**

1. New columns on `Order`:
   - `estimated_shipping_cost: Decimal(12,2)` — write-once, immutable
   - `estimated_shipping_carrier_id: Uuid` (FK → shipping_carriers) — audit trail
   - `estimated_shipping_tariff_applied: ShippingTariffApplied` — NORMAL / BAREM / OWN_CONTRACT
   - `estimated_at: timestamptz` — when the snapshot was captured
2. Schema migration with `BEFORE UPDATE` trigger rejecting changes to these columns (mirrors `reject_snapshot_update` from cost-profile system). See spec §8.4.
3. Wire the V1 service signature `estimateShippingCostForOrder(orderId, tx)` (currently a stub that throws — `apps/api/src/services/shipping-estimator.service.ts:186`) — implement it using:
   - `MAX(items[].variant.dimensionalWeight)` as package desi (per V1 spec §2.2 decision)
   - `order.totalAmount` for Barem range matching
   - Same Barem/desi fallthrough algorithm as variant-level
4. Hook into the sync worker's order-creation flow: call the estimator inside the same transaction that creates the `Order` row. Snapshot fields persist atomically.
5. Test: equivalence test extension covering all 5 outcome states at order level.

**Dependencies:**

- Orders integration feature (webhook receiver, order sync handler) must exist
- `Order` model + `OrderItem` model already in schema (just need to add the new columns)

**Open questions to resolve when picking this up:**

- Should the snapshot include `estimated_shipping_eff_desi` (the actual MAX desi used) for full audit traceability? Probably yes — store it alongside the tariff snapshot.
- What happens when a webhook arrives but a variant's desi is missing? Snapshot fails → `Order.netProfit` stays null, settled later when desi gets backfilled? Or capture `null` and let settlement reconciliation handle? Lean toward the latter.

---

## V2.2 — Settlement reconciliation 🔥

**Scope:**

Compare V2.1's snapshotted estimate against the real shipping cost Trendyol invoices via `cargo-invoice` API (docs at `docs/integrations/trendyol/8-trendyol-muhasebe-ve-finans-entegrasyonu/kargo-faturasi-detaylari.md`). Surface discrepancies as a per-order delta and an aggregate dashboard widget.

**Why:**

Sellers want to know "did the platform charge what we expected?" When estimate ≠ reality consistently, that's a signal: maybe their delivery setup doesn't actually qualify for Barem destek, maybe Trendyol changed rates without us updating, maybe a carrier mid-route swap happened. Reconciliation closes the optimistic-estimate loop documented in memory `estimates-optimistic-settlement-reconciles`.

**Concrete deliverables:**

1. New column on `Order`:
   - `real_shipping_cost: Decimal(12,2)` — filled from settlement
   - `reconciled_at: timestamptz` — when settlement landed
   - `shipping_cost_delta: Decimal(12,2)` — computed column or denormalized for query speed
2. Settlement worker reads cargo-invoice API, joins by `parcelUniqueId` / `orderNumber`, updates the order.
3. Products / orders UI:
   - Per-order delta cell: green when delta ≤ 5%, yellow when 5-15%, red when >15%
   - Dashboard widget: "X siparişlerde tahmin %Y sapma" with drill-down to filtered orders
4. `Order.netProfit` (the V1 sealed value) gets recomputed using `real_shipping_cost` when available, otherwise falls back to estimate. (Or stays as the variance, depending on which semantics matter more — discuss in design phase.)
5. Re-evaluate memory `estimates-optimistic-settlement-reconciles` — if reconciliation shows >X% of orders systematically deviate, maybe V3 introduces a "failed tier" Barem prediction.

**Dependencies:**

- V2.1 (need the snapshot to compare against)
- Settlement integration feature (kargo-invoice API client + worker)

---

## V2.3 — Own contract Excel upload 🟡

**Scope:**

Activate the "Kendi Anlaşmam" path. V1 ships the segment toggle + an empty-state placeholder. V2 makes it functional: seller uploads an Excel file with their own desi/price tariff; the system parses, validates, persists rows in `own_shipping_tariffs` (table already exists, RLS already in place from V1 PR #180).

**Why:**

Sellers often have direct carrier contracts that beat Trendyol's anlaşmalı rates. Without this, "Kendi Anlaşmam" is dead UX in V1.

**Concrete deliverables:**

1. New endpoint: `POST /v1/organizations/:orgId/stores/:storeId/own-shipping-tariff/bulk` — accepts a parsed array of `{desi, priceNet}` rows. Transactional REPLACE semantics (DELETE existing + INSERT new in same transaction).
2. Frontend: file upload UI (use existing project pattern if one exists, e.g., product import — check `apps/web/src/features/products/` for precedent). Parse Excel client-side (e.g., SheetJS) OR server-side.
3. Validate: desi must be integer ≥0, priceNet must be Decimal ≥0, no duplicate desi per store.
4. Display the uploaded tariff in the same `CarrierTariffTable` component (it already renders own tariffs when `shippingTariffSource === 'OWN_CONTRACT'` — needs minor extension to surface the new rows).
5. Allow re-upload (replaces previous tariff fully — log via `created_by`).

**Dependencies:**

None — V1 already laid the schema, RLS, segment toggle, and empty-state. This is pure additive work.

**UX decisions to resolve:**

- Excel template format: just `desi, price_net` columns? Or include `barem_min`, `barem_max`, etc. if own contracts have tier structures?
- What about deletion of own tariff (revert to "use Trendyol")? Probably a "Tarifeyi sıfırla" button alongside upload.

---

## V2.4 — Banner category filters 🟢

**Scope:**

The V1 aggregate banner (`MissingShippingBanner`) currently has ONE "Filtreyi uygula" CTA — clicking filters the products table to all non-OK rows. Users likely want to drill into specific issue types: "Show me only the desi-missing variants" or "Show me only the high-desi overflow variants".

**Concrete deliverables:**

1. Make each category count in the banner breakdown clickable (currently they're plain text):
   - `desi eksik (12)` → filter to `shippingEstimateStatus === 'NO_DESI'`
   - `carrier seçilmemiş (8)` → `'NO_CARRIER'`
   - `yüksek desi (3)` → `'DESI_OVERFLOW'`
2. Backend: add `shippingEstimateStatus` query parameter to `GET /products`. Maps to `WHERE` clause in the products list endpoint.
3. URL state: filter via nuqs (`?shippingStatus=NO_DESI`). Already the project's URL-state convention.
4. Frontend: extend MissingShippingBanner to render category counts as `<Button variant="link">` with onClick handlers that set the URL state.

**Dependencies:**

None.

---

## V2.5 — Live test/preview calculator in Store settings 🟢

**Scope:**

When a seller picks a carrier in store settings, give them a quick "if I sold a 3 desi product for 250 TL, you'd be charged X TL" widget right there. Validates the carrier choice without having to find a real product.

**Concrete deliverables:**

1. Inline widget below the carrier dropdown (or expandable accordion).
2. Inputs: desi (number input, 0-15), salePrice (decimal input).
3. Output: computed estimate via the same algorithm — calls `estimateShippingCost(carrierId, desi, salePrice)` (need to expose this lightweight API surface).
4. Show breakdown: "BAREM uygulanıyor" badge if eligible, "Normal desi tariff" otherwise.

**Dependencies:**

None — V1 service already has the algorithm, just needs a new lightweight API entry point and a small frontend widget.

---

## V2.6 — Tariff history/versioning 🟢

**Scope:**

Currently `shipping_desi_tariffs.effective_from` is captured but `effective_to` doesn't exist. UPDATE statements overwrite the current price. For audit ("what did I estimate orders with on April 15?"), we'd need historical snapshots.

**Why deferred:**

V1 deliberately uses optimistic estimates and reconciles via settlement (per memory `estimates-optimistic-settlement-reconciles`). Settlement gives ground truth; the historical tariff is mostly an audit nice-to-have. Picks up urgency only if V2.2's reconciliation surfaces drift that's hard to debug without history.

**Concrete deliverables (when picked up):**

1. Add `effective_to: Date?` column. NULL means current.
2. Change tariff update path from UPDATE to INSERT-new + UPDATE-old's effective_to. Becomes a "version chain".
3. V2.1's order snapshot stores the tariff row ID — historical lookup gives the exact rate at order time.

**Dependencies:**

V2.2 reconciliation rolling for ≥3 months to see if drift is a problem.

---

## V2.7 — Hepsiburada tariff data seed ⏸

**Scope:**

V1 schema is platform-aware (`Platform` enum on `ShippingCarrier`). Hepsiburada gets seeded the moment Hepsiburada marketplace integration starts.

**Concrete deliverables:**

1. Add Hepsiburada carriers to seed migration (need to research HB's carrier list and tariff structure — possibly different from Trendyol's getProviders shape).
2. Adjust `shipping-estimator.service.ts` if HB's Barem-equivalent uses different field shapes.
3. Update store settings to filter carriers by `store.platform` (`useShippingCarriers(orgId, store.platform)` — already done in V1).

**Dependencies:**

Hepsiburada integration feature first. Currently a placeholder in the `Platform` enum.

---

## V2.8 — `Order.netProfit` write-once DB trigger 🟡

**Scope:**

V1 enforces `Order.netProfit` write-once at the app layer (`profit-calculation.service.ts` checks if non-null before updating). Cost-profile system added a DB trigger (`reject_snapshot_update`) for defense-in-depth. The shipping spec §8.4 noted that we'd add the equivalent for `netProfit` once V2.1 lands, after auditing existing writes for compatibility.

**Concrete deliverables:**

1. Audit every write path that touches `Order.netProfit` — confirm nullable→value only, no value→value updates.
2. Add `reject_netprofit_update` trigger to `supabase/sql/triggers.sql`.
3. Integration test: attempted update raises `42501`.

**Dependencies:**

V2.1 — need order snapshot in place to be sure all the write paths exist.

---

## V2.9 — `ShippingTariffApplied` snapshot persistence on Order 🟡

**Scope:**

V1 has `ShippingTariffApplied` as a service-layer type (`'NORMAL' | 'BAREM' | 'OWN_CONTRACT'`). Not persisted. V2.1's order snapshot should persist this as a column so the UI can display "this order was estimated with Barem destek (X price)" vs "normal tariff (Y price)".

**Concrete deliverables:**

Subsumed by V2.1 — add `estimated_shipping_tariff_applied` column alongside the other snapshot fields. This is listed separately to flag it.

**Dependencies:**

V2.1.

---

## V3+ — Beyond V2 (record only, no commitment)

- **Admin UI for tariff CRUD** — currently sellers see read-only tariff table; ops staff edit via SQL. Becomes valuable if tariff changes ship monthly+ and SQL audit trail is insufficient.
- **Per-product carrier override** — sellers occasionally ship a heavy item via a different carrier. V1 = single store-level default; V3 if real user pain.
- **`changeCargoProvider` API integration** — operational (post-order carrier swap). Different domain than profit estimation, probably its own feature.
- **Carrier logos** — pure polish for dropdown UX.
- **Bulk re-attach UI on carrier switch** — currently React Query invalidation handles this automatically; only matters if optimistic UI bug surfaces.

---

## Cross-cutting Items to Remember

### Reference data seeding pattern

V1 hit a CI gotcha: migration seed INSERTs are skipped by `pnpm db:push` (CI's chosen schema-sync path). Solved via `apps/api/tests/helpers/seed-shipping-reference.ts` + vitest globalSetup. **Pattern to reuse for any future reference-data feature.** A memory entry (`reference-data-seed-via-globalSetup`) should be saved when picking up V2.

### Data-driven thresholds discipline

Memory `marketplace-parameters-data-driven` is load-bearing for everything in this domain. Every new Trendyol parameter (e.g., a 3rd Barem tier, a new desi cap) must land as DB rows — not enum values, not code constants. Re-validate on every V2 PR review.

### Trendyol carrier code authority

Memory `trendyol-carrier-codes` documents `SENDEOMP` (current) vs `KOLAYGELSINMP` (legacy from `changeCargoProvider` doc). V2 work that touches `changeCargoProvider` will need a mapping table — flag it then.

---

## How to Pick This Up

1. Read this file top-to-bottom to refresh context.
2. Check the priority table — pick the topmost unblocked 🔥 / 🟡 item.
3. Open the V1 spec/plan as background (referenced at top of this doc).
4. Brainstorm via `/superpowers:brainstorming` to confirm scope hasn't drifted since V1 shipped.
5. Standard flow: spec → plan → subagent-driven implementation → PR.

If a major Trendyol parameter change shipped between V1 and V2 (new Barem tier, new carrier, etc.), apply the change as a data migration FIRST in a small standalone PR — don't bundle with V2 scope.
